const utils = require('../../utils-module');

async function duplicateEventIds() {
    var results = await utils.Airtable.getDuplicateEventIds();
    if (results.length > 0) utils.Slack.post(`duplicate eventIds: ${JSON.stringify(results)}`);
}

async function eventbrite(checkPast) {
    var events = await utils.Eventbrite.getEvents(checkPast);
    var eventbriteAttendees = {};
    for (var event of events) {
        await utils.Eventbrite.getAttendees(event).then((attendees) => {
            eventbriteAttendees = Object.assign(eventbriteAttendees, attendees);
        })
    }
    var airtableAttendees = await utils.Airtable.getEventbriteRecords(checkPast);

    var results = utils.Common.getAttendeeDifference(eventbriteAttendees, airtableAttendees);
    if (results.add.length > 0) utils.Slack.post(`eventbrite attendees that should be added to airtable: ${JSON.stringify(results.add)}`);
    if (results.cancel.length > 0) utils.Slack.post(`cancelling in airtable: ${JSON.stringify(results.cancel)}`);
    await utils.Airtable.updateByIndividualRecords(results.cancel);
}

async function run() {
    try {
        await duplicateEventIds();
        var checkPast = false; // save time by only checking future eventbrite records
        await eventbrite(checkPast);
    }
    catch (err) {
        var message = `data validation failed: ${err.stack}`;
        utils.Slack.post(message);
        throw new Error(message);
    }
}

module.exports = {
    run: run,
    duplicateEventIds: duplicateEventIds,
    eventbrite: eventbrite
};