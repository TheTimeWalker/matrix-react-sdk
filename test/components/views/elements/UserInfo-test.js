/*
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

import sinon from 'sinon';
import expect from 'expect';
import React from 'react';
import ReactTestUtils from 'react-dom/test-utils';
import sdk from 'matrix-react-sdk';
import * as languageHandler from '../../../../src/languageHandler';
import * as testUtils from '../../../test-utils';
import MatrixClientPeg from "../../../../src/MatrixClientPeg";
import Promise from "bluebird";

// Give UserInfo a matrixClient in its child context
const UserInfo = testUtils.wrapInMatrixClientContext(sdk.getComponent('views.elements.UserInfo'));

function flushPromises() {
    return new Promise(resolve => setImmediate(resolve));
}

describe('UserInfo', function() {
    const testClient = testUtils.createTestClient();
    const otherUserId = "@other_user:matrix2.rog";
    const testRoom = testUtils.createTestRoom("!room:matrix.rog");
    let sandbox;

    const generateRoomMember = (userId=testClient.getUserId(), roomId=testRoom.roomId) => {
        const member = testUtils.createTestRoomMember(userId, roomId);
        member.name = "Display Name";
        member.getMxcAvatarUrl = sinon.stub().returns("some_avatar_url");
        return member;
    };

    const generateUser = () => {

    };

    const generateGroupMember = (userId=testClient.getUserId()) => ({
        userId,
        displayname: "Display Name",
        avatarUrl: "Avatar URL",
    });

    beforeEach(function(done) {
        testUtils.beforeEach(this);
        sandbox = testUtils.stubClient();

        languageHandler.setLanguage('en').done(done);
        languageHandler.setMissingEntryGenerator(function(key) {
            return key.split('|', 2)[1];
        });
    });

    afterEach(function() {
        sandbox.restore();
    });

    it('renders your own room member info', function() {
        const props = {
            user: generateRoomMember(),
            room: testRoom,
        };

        const instance = ReactTestUtils.renderIntoDocument(<UserInfo {...props} />);

        // renders avatar
        const avatar = ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_MemberInfo_avatar");
        expect(avatar.childNodes[0].src).toBe("http://this.is.a.url/");

        // renders profile
        const profile = ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_MemberInfo_profile");
        expect(profile.childNodes[0].innerText).toBe("Display Name");
        expect(profile.childNodes[1].innerText).toBe(testClient.getUserId());
        expect(profile.childNodes[2].innerText).toBe("Unknown");

        // renders member details (power level config) as it is a room member
        ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_MemberInfo_memberDetailsContainer");
        ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_PowerSelector");

        ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_MemberInfo_scrollContainer");
        ReactTestUtils.findRenderedDOMComponentWithClass(instance, "mx_MemberInfo_devices");
        // dms should not be present as this is our own member info
        const dms = ReactTestUtils.scryRenderedDOMComponentsWithClass(instance, "mx_MemberInfo_direct_messages");
        expect(dms.length).toBe(0);

        // Test all buttons
        const buttonGroups = ReactTestUtils.scryRenderedDOMComponentsWithClass(instance, "mx_MemberInfo_buttons");
        expect(buttonGroups.length).toBe(1);

        // Renders User Options correctly for your own user
        expect(buttonGroups[0].childNodes.length).toBe(1);
        expect(buttonGroups[0].childNodes[0].innerText).toBe("Share Link to User");
    });

    it('renders your own room member info with synapse deactivation correctly', function() {
        MatrixClientPeg.get().isSynapseAdministrator = sinon.stub().returns(Promise.resolve(true));

        const props = {
            user: generateRoomMember(),
            room: testRoom,
        };

        const instance = ReactTestUtils.renderIntoDocument(<UserInfo {...props} />);

        return flushPromises().then(() => {
            // Test all buttons
            const buttonGroups = ReactTestUtils.scryRenderedDOMComponentsWithClass(instance, "mx_MemberInfo_buttons");
            expect(buttonGroups.length).toBe(2);

            // Renders User Options correctly for your own user
            expect(buttonGroups[0].childNodes.length).toBe(1);
            expect(buttonGroups[0].childNodes[0].innerText).toBe("Share Link to User");

            // Renders Admin Tools correctly for server admin with no power in room
            expect(buttonGroups[1].childNodes.length).toBe(1);
            expect(buttonGroups[1].childNodes[0].innerText).toBe("Deactivate user");
        });
    });

    // it('renders your own room member info with correct admin tools', function() {
    //
    // });
    //
    // it('renders another\'s room member info for a non-admin', function() {
    //
    // });
    //
    // it('renders another\'s room member info for an admin', function() {
    //
    // });
    //
    // it('handles changes to permissions after being rendered', function() {
    //
    // });
    //
    // it('handles changes to whether the target user is ignored after being rendered', function() {
    //
    // });
});
