var crypto = require('crypto'),
assert = require('assert'),
LdapAuth = require('ldapauth-fork'),
parseDN = require('ldapjs').parseDN;

module.exports = Auth;

function Auth(config, stuff) {
	var self = Object.create(Auth.prototype);
	self._users = {};

	// config for this module
	self._config = config;

	// sinopia logger
	self._logger = stuff.logger;

	// TODO: Set more defaults
	self._config.groupNameAttribute = self._config.groupNameAttribute || 'cn';

	return self;
}

//
// Attempt to authenticate user against LDAP backend
//
Auth.prototype.authenticate = function (user, password, callback) {
	var self = this,
	ldap = new LdapAuth(self._config.client_options);
	ldap.authenticate(user, password, function (err, ldap_user) {

		if (err) {
			// 'No such user' is reported via error
			self._logger.warn({
				user : user,
				err : err,
			}, 'LDAP error @{err}')
			return callback(null, false);
		}

		if (ldap_user) {
			var groups = [user];
			if ('memberOf' in ldap_user) {
				if (!Array.isArray(ldap_user.memberOf)) {
					ldap_user.memberOf = [ldap_user.memberOf];
				}
				for (var i = 0; i < ldap_user.memberOf.length; i++) {
					groups.push("%" + parseDN(ldap_user.memberOf[i]).rdns[0][self._config.groupNameAttribute]);
				}
			}
		}

		ldap.close(function () {
			callback(null, groups);
		});
	})
}
