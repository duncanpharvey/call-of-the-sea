const { nock } = require('../../config.js');

function get(response) {
    nock('https://api.airtable.com:443')
        .get(`/v0/${process.env.airtable_base_id}/By%20Boat%20Sails`)
        .query({ 'fields[]': ['VesselConductingSail', 'BoardingDate', 'BoardingTime', 'DisembarkingDate', 'DisembarkingTime', 'Status', 'TotalCost', 'ScholarshipAwarded', 'Paid', 'Outstanding', 'TotalPassengers', 'Students', 'Adults'] })
        .reply(200, { 'records': response });
}

module.exports = {
    get: get
};