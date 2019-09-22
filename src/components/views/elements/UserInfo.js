/*
Copyright 2015, 2016 OpenMarket Ltd
Copyright 2017, 2018 Vector Creations Ltd
Copyright 2019 Michael Telatynski <7t3chguy@gmail.com>
Copyright 2019 The Matrix.org Foundation C.I.C.

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
*/

import React, {useState, useEffect} from 'react';
import PropTypes from 'prop-types';
import classNames from 'classnames';
import {Group, MatrixClient, Room, RoomMember, User} from 'matrix-js-sdk';
import dis from '../../../dispatcher';
import Modal from '../../../Modal';
import sdk from '../../../index';
import { _t } from '../../../languageHandler';
import createRoom from '../../../createRoom';
import DMRoomMap from '../../../utils/DMRoomMap';
import Unread from '../../../Unread';
import { findReadReceiptFromUserId } from '../../../utils/Receipt';
import AccessibleButton from '../elements/AccessibleButton';
import SdkConfig from '../../../SdkConfig';
import SettingsStore from "../../../settings/SettingsStore";
import MatrixClientPeg from "../../../MatrixClientPeg";
import {EventTimeline} from "matrix-js-sdk";
import AutoHideScrollbar from "../../structures/AutoHideScrollbar";
import * as RoomViewStore from "../../../stores/RoomViewStore";
import MultiInviter from "../../../utils/MultiInviter";
import GroupStore from "../../../stores/GroupStore";

const _disambiguateDevices = (devices) => {
    const names = Object.create(null);
    for (let i = 0; i < devices.length; i++) {
        const name = devices[i].getDisplayName();
        const indexList = names[name] || [];
        indexList.push(i);
        names[name] = indexList;
    }
    for (const name in names) {
        if (names[name].length > 1) {
            names[name].forEach((j)=>{
                devices[j].ambiguous = true;
            });
        }
    }
};

// const _getE2EStatus = (devices) => {
//     const hasUnverifiedDevice = devices.some((device) => device.isUnverified());
//     return hasUnverifiedDevice ? "warning" : "verified";
// };

const DevicesSection = ({cli, userId}) => {
    const [devices, setDevices] = useState(null);
    const [loading, setLoading] = useState(false);

    // Download device lists
    useEffect(() => {
        setDevices(null);
        setLoading(true);

        let cancelled = false;

        async function _downloadDeviceList() {
            try {
                await cli.downloadKeys([userId], true);
                const devices = await cli.getStoredDevicesForUser(userId);

                if (cancelled) {
                    // we got cancelled - presumably a different user now
                    return;
                }

                _disambiguateDevices(devices);
                setLoading(false);
                setDevices(devices);
            } catch (err) {
                setLoading(false);
            }
        }

        _downloadDeviceList();

        // Handle being unmounted
        return () => {
            cancelled = true;
        };
    }, [userId]);


    const onDeviceVerificationChanged = (_userId, device) => {
        if (_userId === userId) {
            // no need to re-download the whole thing; just update our copy of the list.

            // Promise.resolve to handle transition from static result to promise; can be removed in future
            Promise.resolve(cli.getStoredDevicesForUser(userId)).then((devices) => {
                setDevices(devices);
            });
        }
    };

    // Listen to changes
    useEffect(() => {
        cli.on("deviceVerificationChanged", onDeviceVerificationChanged);
        // Handle being unmounted
        return () => {
            cli.removeListener("deviceVerificationChanged", onDeviceVerificationChanged);
        };
    }, []);

    // TODO
    // const e2eStatus = _getE2EStatus(devices);

    const MemberDeviceInfo = sdk.getComponent('rooms.MemberDeviceInfo');
    const Spinner = sdk.getComponent("elements.Spinner");

    if (loading) {
        // still loading
        return <Spinner />;
    }
    if (devices === null) {
        return _t("Unable to load device list");
    }
    if (devices.length === 0) {
        return _t("No devices with registered encryption keys");
    }

    return devices.map((device, i) => <MemberDeviceInfo key={i} userId={userId} device={device} />);
};

const onRoomTileClick = (roomId) => {
    dis.dispatch({
        action: 'view_room',
        room_id: roomId,
    });
};

const DirectChatsSection = ({cli, userId, onNewDMClick}) => {
    // TODO: Immutable DMs replaces a lot of this
    const dmRoomMap = new DMRoomMap(cli);
    // dmRooms will not include dmRooms that we have been invited into but did not join.
    // Because DMRoomMap runs off account_data[m.direct] which is only set on join of dm room.
    // XXX: we potentially want DMs we have been invited to, to also show up here :L
    // especially as logic below concerns specially if we haven't joined but have been invited
    const dmRooms = dmRoomMap.getDMRoomsForUserId(userId);

    const RoomTile = sdk.getComponent("rooms.RoomTile");

    const tiles = [];
    for (const roomId of dmRooms) {
        const room = cli.getRoom(roomId);
        if (room) {
            const myMembership = room.getMyMembership();
            // not a DM room if we have are not joined
            if (myMembership !== 'join') continue;

            const them = room.getMember(userId);
            // not a DM room if they are not joined
            if (!them || !them.membership || them.membership !== 'join') continue;

            const highlight = room.getUnreadNotificationCount('highlight') > 0;

            tiles.push(
                <RoomTile key={room.roomId}
                          room={room}
                          transparent={true}
                          collapsed={false}
                          selected={false}
                          unread={Unread.doesRoomHaveUnreadMessages(room)}
                          highlight={highlight}
                          isInvite={false}
                          onClick={onRoomTileClick}
                />,
            );
        }
    }

    if (tiles.length > 0) {
        return tiles;
    }

    const labelClasses = classNames({
        mx_MemberInfo_createRoom_label: true,
        mx_RoomTile_name: true,
    });

    return <AccessibleButton className="mx_MemberInfo_createRoom" onClick={onNewDMClick}>
        <div className="mx_RoomTile_avatar">
            <img src={require("../../../../res/img/create-big.svg")} width="26" height="26" alt={_t("Start a chat")} />
        </div>
        <div className={labelClasses}><i>{ _t("Start a chat") }</i></div>
    </AccessibleButton>;
};

const UserOptionsSection = ({cli, member, isIgnored, canInvite}) => {
    let ignoreButton = null;
    let insertPillButton = null;
    let inviteUserButton = null;
    let readReceiptButton = null;

    const onShareUserClick = () => {
        const ShareDialog = sdk.getComponent("dialogs.ShareDialog");
        Modal.createTrackedDialog('share room member dialog', '', ShareDialog, {
            target: member,
        });
    };

    // Only allow the user to ignore the user if its not ourselves
    // same goes for jumping to read receipt
    if (member.userId !== cli.getUserId()) {
        const onIgnoreToggle = () => {
            const ignoredUsers = cli.getIgnoredUsers();
            if (isIgnored) {
                const index = ignoredUsers.indexOf(member.userId);
                if (index !== -1) ignoredUsers.splice(index, 1);
            } else {
                ignoredUsers.push(member.userId);
            }

            cli.setIgnoredUsers(ignoredUsers).then(() => {
                // return this.setState({isIgnoring: !this.state.isIgnoring});
            });
        };

        ignoreButton = (
            <AccessibleButton onClick={onIgnoreToggle} className="mx_MemberInfo_field">
                { isIgnored ? _t("Unignore") : _t("Ignore") }
            </AccessibleButton>
        );

        if (member.roomId) {
            const room = cli.getRoom(member.roomId);
            const eventId = room.getEventReadUpTo(member.userId);

            const onReadReceiptButton = function() {
                dis.dispatch({
                    action: 'view_room',
                    highlighted: true,
                    event_id: eventId,
                    room_id: member.roomId,
                });
            };

            const onInsertPillButton = function() {
                dis.dispatch({
                    action: 'insert_mention',
                    user_id: member.userId,
                });
            };

            readReceiptButton = (
                <AccessibleButton onClick={onReadReceiptButton} className="mx_MemberInfo_field">
                    { _t('Jump to read receipt') }
                </AccessibleButton>
            );

            insertPillButton = (
                <AccessibleButton onClick={onInsertPillButton} className={"mx_MemberInfo_field"}>
                    { _t('Mention') }
                </AccessibleButton>
            );
        }

        if (canInvite && (!member || !member.membership || member.membership === 'leave')) {
            const roomId = member && member.roomId ? member.roomId : RoomViewStore.getRoomId();
            const onInviteUserButton = async () => {
                try {
                    // We use a MultiInviter to re-use the invite logic, even though
                    // we're only inviting one user.
                    const inviter = new MultiInviter(roomId);
                    await inviter.invite([member.userId]).then(() => {
                        if (inviter.getCompletionState(member.userId) !== "invited") {
                            throw new Error(inviter.getErrorText(member.userId));
                        }
                    });
                } catch (err) {
                    const ErrorDialog = sdk.getComponent('dialogs.ErrorDialog');
                    Modal.createTrackedDialog('Failed to invite', '', ErrorDialog, {
                        title: _t('Failed to invite'),
                        description: ((err && err.message) ? err.message : _t("Operation failed")),
                    });
                }
            };

            inviteUserButton = (
                <AccessibleButton onClick={onInviteUserButton} className="mx_MemberInfo_field">
                    { _t('Invite') }
                </AccessibleButton>
            );
        }
    }

    const shareUserButton = (
        <AccessibleButton onClick={onShareUserClick} className="mx_MemberInfo_field">
            { _t('Share Link to User') }
        </AccessibleButton>
    );

    return (
        <div className="mx_MemberInfo_container">
            <h3>{ _t("User Options") }</h3>
            <div className="mx_MemberInfo_buttons">
                { readReceiptButton }
                { shareUserButton }
                { insertPillButton }
                { ignoreButton }
                { inviteUserButton }
            </div>
        </div>
    );
};

const _warnSelfDemote = async () => {
    const QuestionDialog = sdk.getComponent("dialogs.QuestionDialog");
    const {finished} = Modal.createTrackedDialog('Demoting Self', '', QuestionDialog, {
        title: _t("Demote yourself?"),
        description:
            <div>
                { _t("You will not be able to undo this change as you are demoting yourself, " +
                    "if you are the last privileged user in the room it will be impossible " +
                    "to regain privileges.") }
            </div>,
        button: _t("Demote"),
    });

    const [confirmed] = await finished;
    return confirmed;
};

const GenericAdminToolsContainer = ({children}) => {
    return (
        <div className="mx_MemberInfo_container">
            <h3>{ _t("Admin Tools") }</h3>
            <div className="mx_MemberInfo_buttons">
                { children }
            </div>
        </div>
    );
};

const RoomAdminToolsContainer = ({cli, children, roomCan, member, startUpdating, stopUpdating, muted, isTargetMod}) => {
    let kickButton;
    let banButton;
    let muteButton;
    let giveModButton;
    let redactButton;

    const membership = member.membership;

    if (roomCan.kick) {
        const onKick = async () => {
            const ConfirmUserActionDialog = sdk.getComponent("dialogs.ConfirmUserActionDialog");
            const {finished} = Modal.createTrackedDialog(
                'Confirm User Action Dialog',
                'onKick',
                ConfirmUserActionDialog,
                {
                    member,
                    action: membership === "invite" ? _t("Disinvite") : _t("Kick"),
                    title: membership === "invite" ? _t("Disinvite this user?") : _t("Kick this user?"),
                    askReason: membership === "join",
                    danger: true,
                },
            );

            const [proceed, reason] = await finished;
            if (!proceed) return;

            startUpdating();
            cli.kick(member.roomId, member.userId, reason || undefined).then(() => {
                // NO-OP; rely on the m.room.member event coming down else we could
                // get out of sync if we force setState here!
                console.log("Kick success");
            }, function(err) {
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                console.error("Kick error: " + err);
                Modal.createTrackedDialog('Failed to kick', '', ErrorDialog, {
                    title: _t("Failed to kick"),
                    description: ((err && err.message) ? err.message : "Operation failed"),
                });
            }).finally(() => {
                stopUpdating();
            });
        };

        const kickLabel = membership === "invite" ? _t("Disinvite") : _t("Kick");
        kickButton = (
            <AccessibleButton className="mx_MemberInfo_field"
                              onClick={onKick}>
                { kickLabel }
            </AccessibleButton>
        );
    }

    if (roomCan.redactMessages) {
        const onRedactAllMessages = async () => {
            const {roomId, userId} = member;
            const room = cli.getRoom(roomId);
            if (!room) {
                return;
            }
            let timeline = room.getLiveTimeline();
            let eventsToRedact = [];
            while (timeline) {
                eventsToRedact = timeline.getEvents().reduce((events, event) => {
                    if (event.getSender() === userId && !event.isRedacted()) {
                        return events.concat(event);
                    } else {
                        return events;
                    }
                }, eventsToRedact);
                timeline = timeline.getNeighbouringTimeline(EventTimeline.BACKWARDS);
            }

            const count = eventsToRedact.length;
            const user = member.name;

            if (count === 0) {
                const InfoDialog = sdk.getComponent("dialogs.InfoDialog");
                Modal.createTrackedDialog('No user messages found to remove', '', InfoDialog, {
                    title: _t("No recent messages by %(user)s found", {user}),
                    description:
                        <div>
                            <p>{ _t("Try scrolling up in the timeline to see if there are any earlier ones.") }</p>
                        </div>,
                });
            } else {
                const QuestionDialog = sdk.getComponent("dialogs.QuestionDialog");

                const {finished} = Modal.createTrackedDialog('Remove recent messages by user', '', QuestionDialog, {
                    title: _t("Remove recent messages by %(user)s", {user}),
                    description:
                        <div>
                            <p>{ _t("You are about to remove %(count)s messages by %(user)s. This cannot be undone. Do you wish to continue?", {count, user}) }</p>
                            <p>{ _t("For a large amount of messages, this might take some time. Please don't refresh your client in the meantime.") }</p>
                        </div>,
                    button: _t("Remove %(count)s messages", {count}),
                });

                const [confirmed] = await finished;
                if (!confirmed) {
                    return;
                }

                // Submitting a large number of redactions freezes the UI,
                // so first yield to allow to rerender after closing the dialog.
                await Promise.resolve();

                console.info(`Started redacting recent ${count} messages for ${user} in ${roomId}`);
                await Promise.all(eventsToRedact.map(async event => {
                    try {
                        await cli.redactEvent(roomId, event.getId());
                    } catch (err) {
                        // log and swallow errors
                        console.error("Could not redact", event.getId());
                        console.error(err);
                    }
                }));
                console.info(`Finished redacting recent ${count} messages for ${user} in ${roomId}`);
            }
        };

        redactButton = (
            <AccessibleButton className="mx_MemberInfo_field" onClick={onRedactAllMessages}>
                { _t("Remove recent messages") }
            </AccessibleButton>
        );
    }

    if (roomCan.ban) {
        const onBanOrUnban = async () => {
            const ConfirmUserActionDialog = sdk.getComponent("dialogs.ConfirmUserActionDialog");
            const {finished} = Modal.createTrackedDialog(
                'Confirm User Action Dialog',
                'onBanOrUnban',
                ConfirmUserActionDialog,
                {
                    member,
                    action: membership === 'ban' ? _t("Unban") : _t("Ban"),
                    title: membership === 'ban' ? _t("Unban this user?") : _t("Ban this user?"),
                    askReason: membership !== 'ban',
                    danger: membership !== 'ban',
                },
            );

            const [proceed, reason] = await finished;
            if (!proceed) return;

            startUpdating();
            let promise;
            if (membership === 'ban') {
                promise = cli.unban(member.roomId, member.userId);
            } else {
                promise = cli.ban(member.roomId, member.userId, reason || undefined);
            }
            promise.then(() => {
                // NO-OP; rely on the m.room.member event coming down else we could
                // get out of sync if we force setState here!
                console.log("Ban success");
            }, function(err) {
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                console.error("Ban error: " + err);
                Modal.createTrackedDialog('Failed to ban user', '', ErrorDialog, {
                    title: _t("Error"),
                    description: _t("Failed to ban user"),
                });
            }).finally(() => {
                stopUpdating();
            });
        };

        let label = _t("Ban");
        if (membership === 'ban') {
            label = _t("Unban");
        }
        banButton = (
            <AccessibleButton className="mx_MemberInfo_field"
                              onClick={onBanOrUnban}>
                { label }
            </AccessibleButton>
        );
    }
    if (roomCan.mute) {
        const onMuteToggle = async () => {
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            const roomId = member.roomId;
            const target = member.userId;
            const room = cli.getRoom(roomId);
            if (!room) return;

            // if muting self, warn as it may be irreversible
            if (target === cli.getUserId()) {
                try {
                    if (!(await _warnSelfDemote())) return;
                } catch (e) {
                    console.error("Failed to warn about self demotion: ", e);
                    return;
                }
            }

            const powerLevelEvent = room.currentState.getStateEvents("m.room.power_levels", "");
            if (!powerLevelEvent) return;

            const isMuted = muted;
            const powerLevels = powerLevelEvent.getContent();
            const levelToSend = (
                (powerLevels.events ? powerLevels.events["m.room.message"] : null) ||
                powerLevels.events_default
            );
            let level;
            if (isMuted) { // unmute
                level = levelToSend;
            } else { // mute
                level = levelToSend - 1;
            }
            level = parseInt(level);

            if (!isNaN(level)) {
                startUpdating();
                cli.setPowerLevel(roomId, target, level, powerLevelEvent).then(() => {
                    // NO-OP; rely on the m.room.member event coming down else we could
                    // get out of sync if we force setState here!
                    console.log("Mute toggle success");
                }, function(err) {
                    console.error("Mute error: " + err);
                    Modal.createTrackedDialog('Failed to mute user', '', ErrorDialog, {
                        title: _t("Error"),
                        description: _t("Failed to mute user"),
                    });
                }).finally(() => {
                    stopUpdating();
                });
            }
        };

        const muteLabel = muted ? _t("Unmute") : _t("Mute");
        muteButton = (
            <AccessibleButton className="mx_MemberInfo_field"
                              onClick={onMuteToggle}>
                { muteLabel }
            </AccessibleButton>
        );
    }
    if (roomCan.toggleMod) {
        const onModToggle = () => {
            const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
            const roomId = member.roomId;
            const target = member.userId;
            const room = cli.getRoom(roomId);
            if (!room) return;

            const powerLevelEvent = room.currentState.getStateEvents("m.room.power_levels", "");
            if (!powerLevelEvent) return;

            const me = room.getMember(cli.getUserId());
            if (!me) return;

            const defaultLevel = powerLevelEvent.getContent().users_default;
            let modLevel = me.powerLevel - 1;
            if (modLevel > 50 && defaultLevel < 50) modLevel = 50; // try to stick with the vector level defaults
            // toggle the level
            const newLevel = isTargetMod ? defaultLevel : modLevel;
            startUpdating();
            cli.setPowerLevel(roomId, target, parseInt(newLevel), powerLevelEvent).then(() => {
                // NO-OP; rely on the m.room.member event coming down else we could
                // get out of sync if we force setState here!
                console.log("Mod toggle success");
            }, function(err) {
                if (err.errcode === 'M_GUEST_ACCESS_FORBIDDEN') {
                    dis.dispatch({action: 'require_registration'});
                } else {
                    console.error("Toggle moderator error:" + err);
                    Modal.createTrackedDialog('Failed to toggle moderator status', '', ErrorDialog, {
                        title: _t("Error"),
                        description: _t("Failed to toggle moderator status"),
                    });
                }
            }).finally(() => {
                stopUpdating();
            });
        };

        const giveOpLabel = isTargetMod ? _t("Revoke Moderator") : _t("Make Moderator");
        giveModButton = <AccessibleButton className="mx_MemberInfo_field" onClick={onModToggle}>
            { giveOpLabel }
        </AccessibleButton>;
    }

    if (kickButton || banButton || muteButton || giveModButton || redactButton || children) {
        return <GenericAdminToolsContainer>
            { muteButton }
            { kickButton }
            { banButton }
            { redactButton }
            { giveModButton }
            { children }
        </GenericAdminToolsContainer>;
    }

    return <div />;
};

const GroupAdminToolsSection = ({cli, children, groupId, groupMember, startUpdating, stopUpdating}) => {
    const [isPrivileged, setIsPrivileged] = useState(false);
    const [isInvited, setIsInvited] = useState(false);

    // Listen to group store changes
    useEffect(() => {
        let unmounted = false;

        const onGroupStoreUpdated = () => {
            if (!unmounted) return;
            setIsPrivileged(GroupStore.isUserPrivileged(groupId));
            setIsInvited(GroupStore.getGroupInvitedMembers(groupId).some(
                (m) => m.userId === groupMember.userId,
            ));
        };

        GroupStore.registerListener(groupId, onGroupStoreUpdated);
        onGroupStoreUpdated();
        // Handle unmount
        return () => {
            unmounted = true;
            GroupStore.unregisterListener(onGroupStoreUpdated);
        };
    }, [groupId]);

    if (isPrivileged) {
        const _onKick = async () => {
            const ConfirmUserActionDialog = sdk.getComponent("dialogs.ConfirmUserActionDialog");
            const {finished} = Modal.createDialog(ConfirmUserActionDialog, {
                matrixClient: cli,
                groupMember,
                action: isInvited ? _t('Disinvite') : _t('Remove from community'),
                title: isInvited ? _t('Disinvite this user from community?')
                    : _t('Remove this user from community?'),
                danger: true,
            });

            const [proceed] = await finished;
            if (!proceed) return;

            startUpdating();
            cli.removeUserFromGroup(groupId, groupMember.userId).then(() => {
                // return to the user list
                dis.dispatch({
                    action: "view_user",
                    member: null,
                });
            }).catch((e) => {
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                Modal.createTrackedDialog('Failed to remove user from group', '', ErrorDialog, {
                    title: _t('Error'),
                    description: isInvited ?
                        _t('Failed to withdraw invitation') :
                        _t('Failed to remove user from community'),
                });
            }).finally(() => {
                stopUpdating();
            });
        };

        const kickButton = (
            <AccessibleButton className="mx_MemberInfo_field" onClick={_onKick}>
                { isInvited ? _t('Disinvite') : _t('Remove from community') }
            </AccessibleButton>
        );

        // No make/revoke admin API yet
        /*const opLabel = this.state.isTargetMod ? _t("Revoke Moderator") : _t("Make Moderator");
        giveModButton = <AccessibleButton className="mx_MemberInfo_field" onClick={this.onModToggle}>
            {giveOpLabel}
        </AccessibleButton>;*/

        return <GenericAdminToolsContainer>
            { kickButton }
            { children }
        </GenericAdminToolsContainer>;
    }

    return <div />;
};

const GroupMember = PropTypes.shape({
    userId: PropTypes.string.isRequired,
    displayname: PropTypes.string, // XXX: GroupMember objects are inconsistent :((
    avatarUrl: PropTypes.string,
    isPrivileged: PropTypes.bool,
});

export default class UserInfo extends React.PureComponent {
    static propTypes = {
        user: PropTypes.oneOfType([
            PropTypes.instanceOf(User),
            PropTypes.instanceOf(RoomMember),
            GroupMember,
        ]).isRequired,
        group: PropTypes.instanceOf(Group),
        room: PropTypes.instanceOf(Room),

        onClose: PropTypes.func,
    };

    static contextTypes = {
        matrixClient: PropTypes.instanceOf(MatrixClient).isRequired,
    };

    constructor(props, context) {
        super(props, context);

        const cli = this.context.matrixClient;

        this.state = {
            roomCan: null,
            room: null,
            groupCan: null,
            synapseCan: {
                deactivate: false,
            },
            ignored: cli.isUserIgnored(this.props.user.userId),
            updating: 0,
        };

        // only display the devices list if our client supports E2E
        this._enableDevices = cli.isCryptoEnabled();

        if (this.props.room) {
            this.state.roomCan = {
                kick: false,
                ban: false,
                mute: false,
                toggleMod: false,
                modifyLevel: false,
                modifyLevelMax: 0,
                redactMessages: false,
            };
            this.state.room = {
                muted: false,
                isMod: false,
            };

            cli.on("Room", this.onRoom);
            cli.on("deleteRoom", this.onDeleteRoom);
            cli.on("Room.timeline", this.onRoomTimeline);
            cli.on("Room.name", this.onRoomName);
            cli.on("Room.receipt", this.onRoomReceipt);
            cli.on("RoomState.events", this.onRoomStateEvents);
            cli.on("RoomMember.name", this.onRoomMemberName);
            cli.on("RoomMember.membership", this.onRoomMemberMembership);
        }

        if (this.props.group) {
            this.state.groupCan = {
                // TODO
            };
            this.state.group = {
               // TODO
            };
        }

        cli.on("accountData", this.onAccountData);

        this._checkSynapseAbilities();
    }

    componentDidMount() {
        this._updateStateForNewUser(this.props.user);
    }

    componentWillReceiveProps(newProps) {
        if (this.props.user.userId !== newProps.user.userId) {
            this._updateStateForNewUser(newProps.user);
        }
    }

    componentWillUnmount() {
        const cli = this.context.matrixClient;
        if (!cli) {
            return;
        }

        cli.removeListener("accountData", this.onAccountData);

        if (this.props.room) {
            cli.removeListener("Room", this.onRoom);
            cli.removeListener("deleteRoom", this.onDeleteRoom);
            cli.removeListener("Room.timeline", this.onRoomTimeline);
            cli.removeListener("Room.name", this.onRoomName);
            cli.removeListener("Room.receipt", this.onRoomReceipt);
            cli.removeListener("RoomState.events", this.onRoomStateEvents);
            cli.removeListener("RoomMember.name", this.onRoomMemberName);
            cli.removeListener("RoomMember.membership", this.onRoomMemberMembership);
        }
    }

    // TODO run this on accountData?
    // _checkIgnoreState() {
    //     this.setState({
    //         ignored: this.context.matrixClient.isUserIgnored(this.props.user.userId),
    //     });
    // }

    async _checkSynapseAbilities() {
        let deactivate = false;
        if (this.context.matrixClient) {
            try {
                deactivate = await this.context.matrixClient.isSynapseAdministrator();
            } catch (e) {
                console.error(e);
            }
        }

        this.setState({
            synapseCan: {
                deactivate,
            },
        });
    }

    async _updateStateForNewUser(user) {
        let newState = {};

        if (user.roomId) {
            newState = await this._calculateRoomPermissions(user);
        }
        // TODO if group

        this.setState(newState);
    }

    onNewDMClick = async () => {
        this.startUpdating();
        await createRoom({dmUserId: this.props.user.userId});
        this.stopUpdating();
    };


    onRoom = (room) => {
        this.forceUpdate();
    };

    onDeleteRoom = (roomId) => {
        this.forceUpdate();
    };

    onRoomTimeline = (ev, room, toStartOfTimeline) => {
        if (toStartOfTimeline) return;
        this.forceUpdate();
    };

    onRoomName = (room) => {
        this.forceUpdate();
    };

    onRoomReceipt = (receiptEvent, room) => {
        // because if we read a notification, it will affect notification count
        // only bother updating if there's a receipt from us
        if (findReadReceiptFromUserId(receiptEvent, this.context.matrixClient.credentials.userId)) {
            this.forceUpdate();
        }
    };

    onRoomStateEvents = (ev, state) => {
        this.forceUpdate();
    };

    onRoomMemberName = (ev, member) => {
        this.forceUpdate();
    };

    onRoomMemberMembership = (ev, member) => {
        if (this.props.user.userId === member.userId) this.forceUpdate();
    };

    onAccountData = (ev) => {
        if (ev.getType() === 'm.direct') {
            this.forceUpdate();
        }
    };

    onSynapseDeactivate = async () => {
        const QuestionDialog = sdk.getComponent('views.dialogs.QuestionDialog');
        const {finished} = Modal.createTrackedDialog('Synapse User Deactivation', '', QuestionDialog, {
            title: _t("Deactivate user?"),
            description:
                <div>{ _t(
                    "Deactivating this user will log them out and prevent them from logging back in. Additionally, " +
                    "they will leave all the rooms they are in. This action cannot be reversed. Are you sure you " +
                    "want to deactivate this user?",
                ) }</div>,
            button: _t("Deactivate user"),
            danger: true,
        });

        const [accepted] = await finished;
        if (!accepted) return;
        try {
            this.context.matrixClient.deactivateSynapseUser(this.props.user.userId);
        } catch (err) {
            const ErrorDialog = sdk.getComponent('dialogs.ErrorDialog');
            Modal.createTrackedDialog('Failed to deactivate user', '', ErrorDialog, {
                title: _t('Failed to deactivate user'),
                description: ((err && err.message) ? err.message : _t("Operation failed")),
            });
        }
    };

    startUpdating = async () => {
        this.setState({ updating: this.state.updating + 1 });
    };

    stopUpdating = async () => {
        this.setState({ updating: this.state.updating - 1 });
    };

    _applyPowerChange(roomId, target, powerLevel, powerLevelEvent) {
        this.startUpdating();
        this.context.matrixClient.setPowerLevel(roomId, target, parseInt(powerLevel), powerLevelEvent).then(
            function() {
                // NO-OP; rely on the m.room.member event coming down else we could
                // get out of sync if we force setState here!
                console.log("Power change success");
            }, function(err) {
                const ErrorDialog = sdk.getComponent("dialogs.ErrorDialog");
                console.error("Failed to change power level " + err);
                Modal.createTrackedDialog('Failed to change power level', '', ErrorDialog, {
                    title: _t("Error"),
                    description: _t("Failed to change power level"),
                });
            },
        ).finally(() => {
            this.stopUpdating();
        }).done();
    }

    onPowerChange = async (powerLevel) => {
        const roomId = this.props.user.roomId;
        const target = this.props.user.userId;
        const room = this.context.matrixClient.getRoom(roomId);
        if (!room) return;

        const powerLevelEvent = room.currentState.getStateEvents("m.room.power_levels", "");
        if (!powerLevelEvent) return;

        if (!powerLevelEvent.getContent().users) {
            this._applyPowerChange(roomId, target, powerLevel, powerLevelEvent);
            return;
        }

        const myUserId = this.context.matrixClient.getUserId();
        const QuestionDialog = sdk.getComponent("dialogs.QuestionDialog");

        // If we are changing our own PL it can only ever be decreasing, which we cannot reverse.
        if (myUserId === target) {
            try {
                if (!(await _warnSelfDemote())) return;
                this._applyPowerChange(roomId, target, powerLevel, powerLevelEvent);
            } catch (e) {
                console.error("Failed to warn about self demotion: ", e);
            }
            return;
        }

        const myPower = powerLevelEvent.getContent().users[myUserId];
        if (parseInt(myPower) === parseInt(powerLevel)) {
            const {finished} = Modal.createTrackedDialog('Promote to PL100 Warning', '', QuestionDialog, {
                title: _t("Warning!"),
                description:
                    <div>
                        { _t("You will not be able to undo this change as you are promoting the user " +
                            "to have the same power level as yourself.") }<br />
                        { _t("Are you sure?") }
                    </div>,
                button: _t("Continue"),
            });

            const [confirmed] = await finished;
            if (confirmed) return;
        }
        this._applyPowerChange(roomId, target, powerLevel, powerLevelEvent);
    };

    async _calculateRoomPermissions(member) {
        const defaultPerms = {
            roomCan: {},
            room: {
                muted: false,
                isMod: false,
            },
        };
        const room = this.context.matrixClient.getRoom(member.roomId);
        if (!room) return defaultPerms;

        const powerLevels = room.currentState.getStateEvents("m.room.power_levels", "");
        if (!powerLevels) return defaultPerms;

        const me = room.getMember(this.context.matrixClient.credentials.userId);
        if (!me) return defaultPerms;

        const them = member;
        return {
            roomCan: await this._calculateCanPermissions(me, them, powerLevels.getContent()),
            room: {
                muted: this._isMuted(them, powerLevels.getContent()),
                isMod: them.powerLevel > powerLevels.getContent().users_default,
            },
        };
    }

    _calculateCanPermissions(me, them, powerLevels) {
        const isMe = me.userId === them.userId;
        const can = {
            kick: false,
            ban: false,
            mute: false,
            modifyLevel: false,
            modifyLevelMax: 0,
            redactMessages: false,
        };

        const canAffectUser = them.powerLevel < me.powerLevel || isMe;
        if (!canAffectUser) {
            //console.log("Cannot affect user: %s >= %s", them.powerLevel, me.powerLevel);
            return can;
        }
        const editPowerLevel = (
            (powerLevels.events ? powerLevels.events["m.room.power_levels"] : null) ||
            powerLevels.state_default
        );

        can.kick = me.powerLevel >= powerLevels.kick;
        can.ban = me.powerLevel >= powerLevels.ban;
        can.invite = me.powerLevel >= powerLevels.invite;
        can.mute = me.powerLevel >= editPowerLevel;
        can.modifyLevel = me.powerLevel >= editPowerLevel && (isMe || me.powerLevel > them.powerLevel);
        can.modifyLevelMax = me.powerLevel;
        can.redactMessages = me.powerLevel >= powerLevels.redact;

        return can;
    }

    _isMuted(member, powerLevelContent) {
        if (!powerLevelContent || !member) return false;

        const levelToSend = (
            (powerLevelContent.events ? powerLevelContent.events["m.room.message"] : null) ||
            powerLevelContent.events_default
        );
        return member.powerLevel < levelToSend;
    }

    onMemberAvatarClick = () => {
        const member = this.props.member;
        const avatarUrl = member.getMxcAvatarUrl();
        if (!avatarUrl) return;

        const httpUrl = this.context.matrixClient.mxcUrlToHttp(avatarUrl);
        const ImageView = sdk.getComponent("elements.ImageView");
        const params = {
            src: httpUrl,
            name: member.name,
        };

        Modal.createDialog(ImageView, params, "mx_Dialog_lightbox");
    };

    render() {
        const cli = this.context.matrixClient;
        const user = this.props.user;

        let synapseDeactivateButton;
        let spinner;

        let directChatsContainer;
        if (user.userId !== cli.getUserId()) {
            directChatsContainer = (
                <div className="mx_MemberInfo_container">
                    <div className="mx_MemberInfo_direct_messages">
                        <h3>{ _t("Direct messages") }</h3>
                        <AccessibleButton
                            onClick={this.onNewDMClick}
                            title={_t("Start a chat")}
                        />
                    </div>
                    <DirectChatsSection cli={cli} userId={user.userId} onNewDMClick={this.onNewDMClick} />
                </div>
            );
        }

        // We don't need a perfect check here, just something to pass as "probably not our homeserver". If
        // someone does figure out how to bypass this check the worst that happens is an error.
        const sameHomeserver = this.props.user.userId.endsWith(`:${MatrixClientPeg.getHomeserverName()}`);
        if (this.state.synapseCan.deactivate && sameHomeserver) {
            synapseDeactivateButton = (
                <AccessibleButton onClick={this.onSynapseDeactivate} className="mx_MemberInfo_field">
                    {_t("Deactivate user")}
                </AccessibleButton>
            );
        }

        let adminToolsContainer;
        if (this.props.room && user.roomId) {
            adminToolsContainer = (
                <RoomAdminToolsContainer
                    cli={cli}
                    member={user}
                    roomCan={this.state.roomCan}
                    isTargetMod={this.state.room.isMod}
                    muted={this.state.room.muted}
                    startUpdating={this.startUpdating}
                    stopUpdating={this.stopUpdating}>
                    { synapseDeactivateButton }
                </RoomAdminToolsContainer>
            );
        } else if (this.props.groupId) {
            adminToolsContainer = (
                <GroupAdminToolsSection
                    cli={cli}
                    groupId={this.props.groupId}
                    groupMember={user}
                    startUpdating={this.startUpdating}
                    stopUpdating={this.stopUpdating}>
                    { synapseDeactivateButton }
                </GroupAdminToolsSection>
            )
        } else if (synapseDeactivateButton) {
            adminToolsContainer = (
                <GenericAdminToolsContainer>
                    { synapseDeactivateButton }
                </GenericAdminToolsContainer>
            );
        }

        if (this.state.updating) {
            const Loader = sdk.getComponent("elements.Spinner");
            spinner = <Loader imgClassName="mx_ContextualMenu_spinner" />;
        }

        const displayName = user.name || user.displayname;

        let presenceState;
        let presenceLastActiveAgo;
        let presenceCurrentlyActive;
        let statusMessage;

        if (user instanceof RoomMember) {
            presenceState = this.props.user.user.presence;
            presenceLastActiveAgo = this.props.user.user.lastActiveAgo;
            presenceCurrentlyActive = this.props.user.user.currentlyActive;

            if (SettingsStore.isFeatureEnabled("feature_custom_status")) {
                statusMessage = this.props.user.user._unstable_statusMessage;
            }
        }

        const enablePresenceByHsUrl = SdkConfig.get()["enable_presence_by_hs_url"];
        let showPresence = true;
        if (enablePresenceByHsUrl && enablePresenceByHsUrl[cli.baseUrl] !== undefined) {
            showPresence = enablePresenceByHsUrl[cli.baseUrl];
        }

        let presenceLabel = null;
        if (showPresence) {
            const PresenceLabel = sdk.getComponent('rooms.PresenceLabel');
            presenceLabel = <PresenceLabel activeAgo={presenceLastActiveAgo}
                                           currentlyActive={presenceCurrentlyActive}
                                           presenceState={presenceState} />;
        }

        let statusLabel = null;
        if (statusMessage) {
            statusLabel = <span className="mx_MemberInfo_statusMessage">{ statusMessage }</span>;
        }

        let memberDetails = null;
        let e2eIconElement;

        if (this.props.room && this.props.user.roomId) { // is in room
            const powerLevelEvent = this.props.room.currentState.getStateEvents("m.room.power_levels", "");
            const powerLevelUsersDefault = powerLevelEvent ? powerLevelEvent.getContent().users_default : 0;

            const PowerSelector = sdk.getComponent('elements.PowerSelector');
            memberDetails = <div>
                <div className="mx_MemberInfo_profileField">
                    <PowerSelector
                        value={parseInt(this.props.user.powerLevel)}
                        maxValue={this.state.roomCan.modifyLevelMax}
                        disabled={!this.state.roomCan.modifyLevel}
                        usersDefault={powerLevelUsersDefault}
                        onChange={this.onPowerChange} />
                </div>

            </div>;

            // TODO fixme
            // const isEncrypted = cli.isRoomEncrypted(this.props.room.roomId);
            // if (this.state.e2eStatus && isEncrypted) {
            //     e2eIconElement = (<E2EIcon status={this.state.e2eStatus} isUser={true} />);
            // }
        }

        const avatarUrl = user.getMxcAvatarUrl ? user.getMxcAvatarUrl() : user.avatarUrl;
        let avatarElement;
        if (avatarUrl) {
            const httpUrl = this.context.matrixClient.mxcUrlToHttp(avatarUrl, 800, 800);
            avatarElement = <div className="mx_MemberInfo_avatar" onClick={this.onMemberAvatarClick}>
                <img src={httpUrl} alt={_t("Profile picture")} />
            </div>;
        }

        let closeButton;
        if (this.props.onClose) {
            closeButton = <AccessibleButton
                className="mx_MemberInfo_cancel"
                onClick={this.props.onClose}
                title={_t('Close')} />;
        }

        let devicesSection;
        if (this._enableDevices) {
            if (this.props.room) {
                // TODO memoize
                if (cli.isRoomEncrypted(this.props.room.roomId)) {
                    devicesSection = <DevicesSection cli={cli} userId={user.userId} />;
                } else {
                    devicesSection = _t("Messages in this room are not end-to-end encrypted.");
                }
            } // TODO what to render for GroupMember
        } else {
            devicesSection = _t("This client does not support end-to-end encryption.");
        }

        let devicesContainer;
        if (devicesSection) {
            devicesContainer = (
                <div className="mx_MemberInfo_container">
                    <h3>{ _t("Trust & Devices") }</h3>
                    <div className="mx_MemberInfo_devices">
                        { devicesSection }
                    </div>
                </div>
            );
        }

        return (
            <div className="mx_MemberInfo">
                <div className="mx_MemberInfo_name">
                    { closeButton }
                    { e2eIconElement }
                </div>
                { avatarElement }

                <div className="mx_MemberInfo_container">
                    <div className="mx_MemberInfo_profile">
                        <div className="mx_MemberInfo_profileField">
                            <h2>{ displayName }</h2>
                        </div>
                        <div className="mx_MemberInfo_profileField">
                            { user.userId }
                        </div>
                        <div className="mx_MemberInfo_profileField">
                            {presenceLabel}
                            {statusLabel}
                        </div>
                    </div>
                </div>

                { memberDetails && <div className="mx_MemberInfo_container mx_MemberInfo_memberDetailsContainer">
                    <div className="mx_MemberInfo_memberDetails">
                        { memberDetails }
                    </div>
                </div> }

                <AutoHideScrollbar className="mx_MemberInfo_scrollContainer">
                    { devicesContainer }
                    { directChatsContainer }

                    <UserOptionsSection
                        cli={cli}
                        canInvite={this.state.roomCan ? this.state.roomCan.invite : false}
                        isIgnored={this.state.isIgnored}
                        member={user} />

                    { adminToolsContainer }

                    { spinner }
                </AutoHideScrollbar>
            </div>
        );
    }
}
