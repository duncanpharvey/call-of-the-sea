const tasks = require('./tasks');

async function run() {
    await tasks.validateData.run();
    await tasks.syncReportingTable.run();
    await tasks.airtableToGoogleSheets.run();
}

module.exports = {
    run: run
};