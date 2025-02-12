/*
Copyright 2017 Michael Telatynski <7t3chguy@gmail.com>

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

import React from 'react';
import createReactClass from 'create-react-class';
import PropTypes from 'prop-types';
import sdk from '../../../index';
import SdkConfig from '../../../SdkConfig';
import withValidation from '../elements/Validation';
import { _t } from '../../../languageHandler';
import MatrixClientPeg from '../../../MatrixClientPeg';

export default createReactClass({
    displayName: 'CreateRoomDialog',
    propTypes: {
        onFinished: PropTypes.func.isRequired,
    },

    getInitialState() {
        const config = SdkConfig.get();
        return {
            isPublic: false,
            name: "",
            topic: "",
            alias: "",
            detailsOpen: false,
            noFederate: config.default_federate === false,
            nameIsValid: false,
        };
    },

    _roomCreateOptions() {
        const createOpts = {};
        createOpts.name = this.state.name;
        if (this.state.isPublic) {
            createOpts.visibility = "public";
            createOpts.preset = "public_chat";
            // to prevent createRoom from enabling guest access
            createOpts['initial_state'] = [];
            const {alias} = this.state;
            const localPart = alias.substr(1, alias.indexOf(":") - 1);
            createOpts['room_alias_name'] = localPart;
        }
        if (this.state.topic) {
            createOpts.topic = this.state.topic;
        }
        if (this.state.noFederate) {
            createOpts.creation_content = {'m.federate': false};
        }
        return createOpts;
    },

    componentDidMount() {
        this._detailsRef.addEventListener("toggle", this.onDetailsToggled);
        // move focus to first field when showing dialog
        this._nameFieldRef.focus();
    },

    componentWillUnmount() {
        this._detailsRef.removeEventListener("toggle", this.onDetailsToggled);
    },

    onOk: async function() {
        const activeElement = document.activeElement;
        if (activeElement) {
            activeElement.blur();
        }
        await this._nameFieldRef.validate({allowEmpty: false});
        if (this._aliasFieldRef) {
            await this._aliasFieldRef.validate({allowEmpty: false});
        }
        // Validation and state updates are async, so we need to wait for them to complete
        // first. Queue a `setState` callback and wait for it to resolve.
        await new Promise(resolve => this.setState({}, resolve));
        if (this.state.nameIsValid && (!this._aliasFieldRef || this._aliasFieldRef.isValid)) {
            this.props.onFinished(true, this._roomCreateOptions());
        } else {
            let field;
            if (!this.state.nameIsValid) {
                field = this._nameFieldRef;
            } else if (this._aliasFieldRef && !this._aliasFieldRef.isValid) {
                field = this._aliasFieldRef;
            }
            if (field) {
                field.focus();
                field.validate({ allowEmpty: false, focused: true });
            }
        }
    },

    onCancel: function() {
        this.props.onFinished(false);
    },

    onNameChange(ev) {
        this.setState({name: ev.target.value});
    },

    onTopicChange(ev) {
        this.setState({topic: ev.target.value});
    },

    onPublicChange(isPublic) {
        this.setState({isPublic});
    },

    onAliasChange(alias) {
        this.setState({alias});
    },

    onDetailsToggled(ev) {
        this.setState({detailsOpen: ev.target.open});
    },

    onNoFederateChange(noFederate) {
        this.setState({noFederate});
    },

    collectDetailsRef(ref) {
        this._detailsRef = ref;
    },

    async onNameValidate(fieldState) {
        const result = await this._validateRoomName(fieldState);
        this.setState({nameIsValid: result.valid});
        return result;
    },

    _validateRoomName: withValidation({
        rules: [
            {
                key: "required",
                test: async ({ value }) => !!value,
                invalid: () => _t("Please enter a name for the room"),
            },
        ],
    }),

    render: function() {
        const BaseDialog = sdk.getComponent('views.dialogs.BaseDialog');
        const DialogButtons = sdk.getComponent('views.elements.DialogButtons');
        const Field = sdk.getComponent('views.elements.Field');
        const LabelledToggleSwitch = sdk.getComponent('views.elements.LabelledToggleSwitch');
        const RoomAliasField = sdk.getComponent('views.elements.RoomAliasField');

        let privateLabel;
        let publicLabel;
        let aliasField;
        if (this.state.isPublic) {
            publicLabel = (<p>{_t("Set a room alias to easily share your room with other people.")}</p>);
            const domain = MatrixClientPeg.get().getDomain();
            aliasField = (
                <div className="mx_CreateRoomDialog_aliasContainer">
                    <RoomAliasField id="alias" ref={ref => this._aliasFieldRef = ref} onChange={this.onAliasChange} domain={domain} />
                </div>
            );
        } else {
            privateLabel = (<p>{_t("This room is private, and can only be joined by invitation.")}</p>);
        }

        const title = this.state.isPublic ? _t('Create a public room') : _t('Create a private room');
        return (
            <BaseDialog className="mx_CreateRoomDialog" onFinished={this.props.onFinished}
                title={title}
            >
                <form onSubmit={this.onOk}>
                    <div className="mx_Dialog_content">
                        <Field id="name" ref={ref => this._nameFieldRef = ref} label={ _t('Name') } onChange={this.onNameChange} onValidate={this.onNameValidate} value={this.state.name} className="mx_CreateRoomDialog_name" />
                        <Field id="topic" label={ _t('Topic (optional)') } onChange={this.onTopicChange} value={this.state.topic} />
                        <LabelledToggleSwitch label={ _t("Make this room public")} onChange={this.onPublicChange} value={this.state.isPublic} />
                        { privateLabel }
                        { publicLabel }
                        { aliasField }
                        <details ref={this.collectDetailsRef} className="mx_CreateRoomDialog_details">
                            <summary className="mx_CreateRoomDialog_details_summary">{ this.state.detailsOpen ? _t('Hide advanced') : _t('Show advanced') }</summary>
                            <LabelledToggleSwitch label={ _t('Block users on other matrix homeservers from joining this room (This setting cannot be changed later!)')} onChange={this.onNoFederateChange} value={this.state.noFederate} />
                        </details>
                    </div>
                </form>
                <DialogButtons primaryButton={_t('Create Room')}
                    onPrimaryButtonClick={this.onOk}
                    onCancel={this.onCancel} />
            </BaseDialog>
        );
    },
});
