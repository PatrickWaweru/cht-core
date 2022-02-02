const path = require('path');
const couchAdminUserService = require('@medic/couch-admin-user');

const { UNIT_TEST_ENV, COUCH_URL, BUILDS_URL } = process.env;
const DEFAULT_BUILDS_URL = 'https://staging.dev.medicmobile.org/_couch/builds';

module.exports.buildsUrl = BUILDS_URL || DEFAULT_BUILDS_URL;
module.exports.ddoc = 'medic';

const initialize = async () => {
  if (!UNIT_TEST_ENV && !COUCH_URL) {
    throw new Error(
      'Please define a COUCH_URL in your environment e.g. \n' +
      'export COUCH_URL=\'http://admin:123qwe@localhost:5984/medic\'\n\n' +
      'If you are running unit tests use UNIT_TEST_ENV=1 in your environment.\n'
    );
  }

  const couchUrl = new URL(COUCH_URL);
  const serverUrl = new URL(COUCH_URL);
  serverUrl.pathname = '';

  const { username, password } = await couchAdminUserService.create('cht-admin', serverUrl.toString());
  couchUrl.username = username;
  couchUrl.password = password;

  serverUrl.username = username;
  serverUrl.password = password;

  module.exports.couchUrl = couchUrl.toString();
  module.exports.serverUrl = serverUrl.toString();
  module.exports.protocol = serverUrl.protocol;
  module.exports.port = serverUrl.port;
  module.exports.host = serverUrl.hostname;
  module.exports.db = couchUrl.pathname;
  module.exports.username = username;
  module.exports.password = password;
};

let deployInfo;
module.exports.setDeployInfo = (newDeployInfo = {}) => {
  deployInfo = newDeployInfo;
};

module.exports.getDeployInfo = () => deployInfo;
module.exports.buildPath = path.join(__dirname, '..', 'build');
module.exports.staticPath = path.join(module.exports.buildPath, 'static');
module.exports.webappPath = path.join(module.exports.staticPath, 'webapp');
module.exports.loginPath = path.join(module.exports.staticPath, 'login');
module.exports.defaultDocsPath = path.join(module.exports.buildPath, 'default-docs');
module.exports.ddocsPath = path.join(module.exports.buildPath, 'ddocs');
module.exports.upgradePath = path.join(module.exports.buildPath, 'upgrade');
module.exports.resourcesPath = path.join(__dirname, '..', 'resources');
module.exports.isTesting = module.exports.db === 'medic-test';
module.exports.initialize = initialize;
