process.env.NODE_ENV = "test";

const nock = require('nock');
const chai = require('chai');
const spies = require('chai-spies');
chai.use(spies);
const expect = chai.expect;

const nocks = require('./nocks');
const tasks = require('../tasks');
const utils = require('../utils-module');
const app = require('../app.js');

nock.disableNetConnect();
nock.emitter.on('no match', (req) => {
    throw new Error(`request not mocked: ${req.method} ${req.host} ${req.path}`);
});

function cleanNocks() {
    if (!nock.isDone()) {
        this.test.error(new Error('Not all nock interceptors were used!'));
    }
    nock.cleanAll();
}

describe('App Start', async function () {
    beforeEach(() => {
        chai.spy.on(tasks.validateData, 'run');
        chai.spy.on(tasks.syncReportingTable, 'run');
        chai.spy.on(tasks.airtableToGoogleSheets, 'run');
    });

    afterEach(() => {
        cleanNocks();
        chai.spy.restore(tasks.validateData, 'run');
        chai.spy.restore(tasks.syncReportingTable, 'run');
        chai.spy.restore(tasks.airtableToGoogleSheets, 'run');
    });

    it('should call all tasks on app run', async function () {
        nocks.Eventbrite.getEventsGeneric();
        nocks.Airtable.get();
        nocks.Google.auth();
        nocks.Google.put();
        nocks.Google.post();
        await app.run();
        expect(tasks.validateData.run).to.have.been.called.once;
        expect(tasks.syncReportingTable.run).to.have.been.called.once;
        expect(tasks.airtableToGoogleSheets.run).to.have.been.called.once;
    });
});

describe('Data Validation', async function () {
    beforeEach(() => {
        chai.spy.on(utils.Slack, 'post');
    });

    afterEach(() => {
        cleanNocks();
        chai.spy.restore(utils.Slack, 'post');
    });

    describe('Duplicate EventIds', async function () {
        it('should not post to slack if there are no duplicate eventIds', async function () {
            nocks.Airtable.byBoatSails([
                { "id": "boatId1", "fields": { "EventId": "eventId1" } }
            ]);

            nocks.Airtable.byIndividualSails([
                { "id": "indivId1", "fields": { "EventId": "eventId2" } }
            ]);

            await tasks.validateData.duplicateEventIds();
            expect(utils.Slack.post).to.not.have.been.called;
        });

        it('should post to slack if there are duplicate by boat sail eventIds', async function () {
            nocks.Airtable.byBoatSails([
                { "id": "boatId1", "fields": { "EventId": "eventId1" } },
                { "id": "boatId2", "fields": { "EventId": "eventId1" } }
            ]);

            nocks.Airtable.byIndividualSails([]);

            await tasks.validateData.duplicateEventIds();
            expect(utils.Slack.post).to.have.been.called.once.with.exactly('duplicate eventIds: ["eventId1"]');
        });

        it('should not post to slack if there are duplicate by individual sail eventIds', async function () {
            nocks.Airtable.byBoatSails([]);

            nocks.Airtable.byIndividualSails([
                { "id": "indivId1", "fields": { "EventId": "eventId1" } },
                { "id": "indivId2", "fields": { "EventId": "eventId1" } }
            ]);

            await tasks.validateData.duplicateEventIds();
            expect(utils.Slack.post).to.not.have.been.called;
        });

        it('should post to slack if there are duplicate eventIds across by boat sails and by individual sails', async function () {
            nocks.Airtable.byBoatSails([
                { "id": "boatId1", "fields": { "EventId": "eventId1" } }
            ]);

            nocks.Airtable.byIndividualSails([
                { "id": "indivId1", "fields": { "EventId": "eventId1" } }
            ]);

            await tasks.validateData.duplicateEventIds();
            expect(utils.Slack.post).to.have.been.called.once.with.exactly('duplicate eventIds: ["eventId1"]');
        });

        it('should post to slack if there are duplicate eventIds within by boat sails and across by boat sails and by individual sails', async function () {
            nocks.Airtable.byBoatSails([
                { "id": "boatId1", "fields": { "EventId": "eventId1" } },
                { "id": "boatId2", "fields": { "EventId": "eventId1" } },
                { "id": "boatId3", "fields": { "EventId": "eventId2" } }
            ]);

            nocks.Airtable.byIndividualSails([
                { "id": "indivId1", "fields": { "EventId": "eventId1" } },
                { "id": "indivId2", "fields": { "EventId": "eventId2" } }
            ]);

            await tasks.validateData.duplicateEventIds();
            expect(utils.Slack.post).to.have.been.called.once.with.exactly('duplicate eventIds: ["eventId1","eventId2"]');
        });
    });

    describe('Eventbrite', async function () {
        it('should cancel records in airtable if cancelled or not in eventbrite', async function () {
            nocks.Eventbrite.getEvents([
                { "id": "eventId1" }
            ]);

            nocks.Eventbrite.getAttendees("eventId1", [
                { "id": "attendeeId1", "cancelled": true }
            ]);

            nocks.Airtable.eventbriteRecords([
                { "id": "participantId1", "fields": { "EventbriteEventId": "eventId1", "EventbriteAttendeeId": "attendeeId1" } },
                { "id": "participantId2", "fields": { "EventbriteEventId": "eventId1", "EventbriteAttendeeId": "attendeeId2" } }
            ]);

            updateRequest = [
                { "id": "participantId1", "fields": { "Status": "Cancelled", "CancellationReason": "Cancelled in Eventbrite, Airtable record updated via script" } },
                { "id": "participantId2", "fields": { "Status": "Cancelled", "CancellationReason": "Cancelled in Eventbrite, Airtable record updated via script" } }
            ];

            updateResponse = [
                { "id": "participantId1" },
                { "id": "participantId2" }
            ];

            nocks.Airtable.updateByIndividualSails(updateRequest, updateResponse);

            await tasks.validateData.eventbrite(false);
        });

        it('should not cancel records in airtable if not cancelled in eventbrite', async function () {
            nocks.Eventbrite.getEvents([
                { "id": "eventId1" }
            ]);

            nocks.Eventbrite.getAttendees("eventId1", [
                { "id": "attendeeId1", "cancelled": false }
            ]);

            nocks.Airtable.eventbriteRecords([
                { "id": "participantId1", "fields": { "EventbriteEventId": "eventId1", "EventbriteAttendeeId": "attendeeId1" } }
            ]);

            await tasks.validateData.eventbrite(false);
        });

        it('should post to slack if eventbrite records need to be added to airtable', async function () {
            nocks.Eventbrite.getEvents([
                { "id": "eventId1" }
            ]);

            nocks.Eventbrite.getAttendees("eventId1", [
                { "id": "attendeeId1", "cancelled": false }
            ]);

            nocks.Airtable.eventbriteRecords([]);

            await tasks.validateData.eventbrite(false);
            expect(utils.Slack.post).to.have.been.called.once.with.exactly('eventbrite attendees that should be added to airtable: [{"attendeeId":"attendeeId1","eventId":"eventId1"}]');
        });
    });

});

describe('Airtable to Google Sheets', async function () {
    afterEach(cleanNocks);

    it('should update google sheets with reporting data from airtable', async function () {
        nocks.Airtable.linkedReportingRecordsAllFields([
            { "id": "airtableId1", "fields": { "ID": 1, "EventId": "eventId1", "ByBoatSails": ["byBoatId1"], "TotalCost": [0], "TotalPassengers": [0], "DisembarkingDate": "2020-01-01", "BoardingDate": "2020-01-01", "VesselConductingSail": ["Matthew Turner"], "CapacityWeight": 1, "SailingSegments": [1], "Paid": [0], "Outstanding": [0] } },
            { "id": "airtableId2", "fields": { "ID": 2, "EventId": "eventId2", "ByIndividualSails": ["byIndivId1", "byIndivId2"], "TotalCost": [0], "TotalPassengers": [0], "DisembarkingDate": "2020-01-07", "BoardingDate": "2020-01-02", "VesselConductingSail": ["Seaward"], "CapacityWeight": 1, "SailingSegments": [1], "Paid": [0], "Outstanding": [0] } }
        ]);

        nocks.Airtable.byBoatSailIds([
            { "id": "byBoatId1", "fields": { "Sail_Id": 3 } }
        ]);

        nocks.Airtable.byIndividualSailIds([
            { "id": "byIndivId1", "fields": { "Participant_Id": 4 } },
            { "id": "byIndivId2", "fields": { "Participant_Id": 5 } }
        ]);

        nocks.Google.auth();
        nocks.Google.freezeSheet();
        nocks.Google.clearSheet();

        nocks.Google.updateSheet({
            "values": [process.env.fields.split(', '),
            [1, "eventId1", "3", null, "Matthew Turner", "0", "2020-01-01", "2020-01-01", "1", "0", 1, null, null, null, "0", "0"],
            [2, "eventId2", null, "4\n5", "Seaward", "0", "2020-01-02", "2020-01-07", "1", "0", 1, null, null, null, "0", "0"]]
        });

        await tasks.airtableToGoogleSheets.run();
    });
});


describe('Sync Airtable Reporting Table', async function () {

    afterEach(cleanNocks);

    it('should add by boat sail records to reporting table if missing', async function () {
        nocks.Airtable.unlinkedReportingRecords([]);

        nocks.Airtable.linkedReportingRecords([]);

        nocks.Airtable.byBoatSails([
            { "id": "boatId1", "fields": { "EventId": "eventId1" } }
        ]);

        nocks.Airtable.byIndividualSails([]);

        var addRequest = [
            { "fields": { "EventId": "eventId1", "ByBoatSails": ["boatId1"] } }
        ];

        var addResponse = [
            { "id": "newId1" }
        ];

        nocks.Airtable.addReportingRecords(addRequest, addResponse);

        await tasks.syncReportingTable.run();
    });

    it('should add by individual sail records to reporting table if missing', async function () {
        nocks.Airtable.unlinkedReportingRecords([]);

        nocks.Airtable.linkedReportingRecords([
            { "id": "reportingId1", "fields": { "EventId": "eventId2", "ByIndividualSails": ["indivId2"] } }
        ]);

        nocks.Airtable.byBoatSails([]);

        nocks.Airtable.byIndividualSails([
            { "id": "indivId1", "fields": { "EventId": "eventId1" } },
            { "id": "indivId2", "fields": { "EventId": "eventId2" } },
            { "id": "indivId3", "fields": { "EventId": "eventId2" } }
        ]);

        var addRequest = [
            { "fields": { "EventId": "eventId1", "ByIndividualSails": ["indivId1"] } },
            { "fields": { "EventId": "eventId2", "ByIndividualSails": ["indivId2", "indivId3"] } }
        ];

        var addResponse = [
            { "id": "newId1" },
            { "id": "newId2" }
        ];

        nocks.Airtable.addReportingRecords(addRequest, addResponse);

        var deleteRequest = '?records%5B%5D=reportingId1';

        var deleteResponse = [
            { deleted: true, id: 'reportingId1' }
        ];

        nocks.Airtable.deleteReportingRecords(deleteRequest, deleteResponse);

        await tasks.syncReportingTable.run();
    });

    it('should update by boat sail records in reporting table if different', async function () {
        nocks.Airtable.unlinkedReportingRecords([]);

        nocks.Airtable.linkedReportingRecords([
            { "id": "reportingId1", "fields": { "EventId": "eventId1", "ByBoatSails": ["boatId3"] } },
            { "id": "reportingId2", "fields": { "EventId": "eventId3", "ByBoatSails": ["boatId2"] } }
        ]);

        nocks.Airtable.byBoatSails([
            { "id": "boatId1", "fields": { "EventId": "eventId1" } },
            { "id": "boatId2", "fields": { "EventId": "eventId2" } }
        ]);

        nocks.Airtable.byIndividualSails([]);

        var addRequest = [
            { "fields": { "EventId": "eventId1", "ByBoatSails": ["boatId1"] } },
            { "fields": { "EventId": "eventId2", "ByBoatSails": ["boatId2"] } }
        ];

        var addResponse = [
            { "id": "newId1" },
            { "id": "newId2" }
        ];

        nocks.Airtable.addReportingRecords(addRequest, addResponse);

        var deleteRequest = '?records%5B%5D=reportingId1&records%5B%5D=reportingId2';

        var deleteResponse = [
            { deleted: true, id: 'reportingId1' },
            { deleted: true, id: 'reportingId2' }
        ];

        nocks.Airtable.deleteReportingRecords(deleteRequest, deleteResponse);

        await tasks.syncReportingTable.run();
    });

    it('should update by individual sail records in reporting table if different', async function () {
        nocks.Airtable.unlinkedReportingRecords([]);

        nocks.Airtable.linkedReportingRecords([
            { "id": "reportingId1", "fields": { "EventId": "eventId1", "ByIndividualSails": ["indivId3"] } },
            { "id": "reportingId2", "fields": { "EventId": "eventId3", "ByIndividualSails": ["indivId2"] } },
            { "id": "reportingId3", "fields": { "EventId": "eventId4", "ByIndividualSails": ["indivId3"] } }
        ]);

        nocks.Airtable.byBoatSails([]);

        nocks.Airtable.byIndividualSails([
            { "id": "indivId1", "fields": { "EventId": "eventId1" } },
            { "id": "indivId2", "fields": { "EventId": "eventId2" } },
            { "id": "indivId3", "fields": { "EventId": "eventId4" } },
            { "id": "indivId4", "fields": { "EventId": "eventId4" } }
        ]);

        var addRequest = [
            { "fields": { "EventId": "eventId1", "ByIndividualSails": ["indivId1"] } },
            { "fields": { "EventId": "eventId2", "ByIndividualSails": ["indivId2"] } },
            { "fields": { "EventId": "eventId4", "ByIndividualSails": ["indivId3", "indivId4"] } }
        ];

        var addResponse = [
            { "id": "newId1" },
            { "id": "newId2" },
            { "id": "newId3" }
        ];

        nocks.Airtable.addReportingRecords(addRequest, addResponse);

        var deleteRequest = '?records%5B%5D=reportingId1&records%5B%5D=reportingId2&records%5B%5D=reportingId3';

        var deleteResponse = [
            { deleted: true, id: 'reportingId1' },
            { deleted: true, id: 'reportingId2' },
            { deleted: true, id: 'reportingId3' }
        ];

        nocks.Airtable.deleteReportingRecords(deleteRequest, deleteResponse);

        await tasks.syncReportingTable.run();
    });

    it('should not add any records to reporting table if already in sync', async function () {
        nocks.Airtable.unlinkedReportingRecords([]);

        nocks.Airtable.linkedReportingRecords([
            { "id": "reportingId1", "fields": { "EventId": "eventId1", "ByBoatSails": ["boatId1"] } },
            { "id": "reportingId2", "fields": { "EventId": "eventId2", "ByIndividualSails": ["indivId1"] } },
            { "id": "reportingId3", "fields": { "EventId": "eventId3", "ByIndividualSails": ["indivId2", "indivId3"] } }
        ]);

        nocks.Airtable.byBoatSails([
            { "id": "boatId1", "fields": { "EventId": "eventId1" } }
        ]);

        nocks.Airtable.byIndividualSails([
            { "id": "indivId1", "fields": { "EventId": "eventId2" } },
            { "id": "indivId2", "fields": { "EventId": "eventId3" } },
            { "id": "indivId3", "fields": { "EventId": "eventId3" } }
        ]);

        await tasks.syncReportingTable.run();
    });

    it('should remove records from reporting table if linked to both by boat and by individual sails or neither', async function () {
        nocks.Airtable.unlinkedReportingRecords([
            { "id": "reportingId1" }
        ]);

        nocks.Airtable.linkedReportingRecords([]);
        nocks.Airtable.byBoatSails([]);
        nocks.Airtable.byIndividualSails([]);

        var deleteRequest = '?records%5B%5D=reportingId1';

        var deleteResponse = [
            { deleted: true, id: 'reportingId1' }
        ];

        nocks.Airtable.deleteReportingRecords(deleteRequest, deleteResponse);

        await tasks.syncReportingTable.run();
    });

    it('should add, update, and remove records in reporting table simultaneously', async function () {
        nocks.Airtable.unlinkedReportingRecords([
            { "id": "reportingId1" },
            { "id": "reportingId2" }]);

        nocks.Airtable.linkedReportingRecords([
            { "id": "reportingId3", "fields": { "EventId": "eventId3", "ByBoatSails": ["boatId2"] } },
            { "id": "reportingId4", "fields": { "EventId": "eventId5", "ByBoatSails": ["boatId3"] } },
            { "id": "reportingId5", "fields": { "EventId": "eventId6", "ByBoatSails": ["boatId4"] } }
        ]);

        nocks.Airtable.byBoatSails([
            { "id": "boatId1", "fields": { "EventId": "eventId2" } },
            { "id": "boatId2", "fields": { "EventId": "eventId4" } }
        ]);

        nocks.Airtable.byIndividualSails([
            { "id": "indivId1", "fields": { "EventId": "eventId1" } }
        ]);

        var addRequest = [
            { "fields": { "EventId": "eventId2", "ByBoatSails": ["boatId1"] } },
            { "fields": { "EventId": "eventId4", "ByBoatSails": ["boatId2"] } },
            { "fields": { "EventId": "eventId1", "ByIndividualSails": ["indivId1"] } }
        ];

        var addResponse = [
            { "id": "newId1" },
            { "id": "newId2" }
        ];

        nocks.Airtable.addReportingRecords(addRequest, addResponse);

        var deleteRequest = '?records%5B%5D=reportingId1&records%5B%5D=reportingId2&records%5B%5D=reportingId3&records%5B%5D=reportingId4&records%5B%5D=reportingId5';

        var deleteResponse = [
            { deleted: true, id: 'reportingId1' },
            { deleted: true, id: 'reportingId2' },
            { deleted: true, id: 'reportingId3' },
            { deleted: true, id: 'reportingId4' },
            { deleted: true, id: 'reportingId5' }
        ];

        nocks.Airtable.deleteReportingRecords(deleteRequest, deleteResponse);

        await tasks.syncReportingTable.run();
    });
});