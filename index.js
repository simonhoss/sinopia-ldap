var fs = require('fs')
var Path = require('path')
var utils = require('./utils')

module.exports = HTPasswd

function HTPasswd(config, stuff) {
  if (!(this instanceof HTPasswd)) return new HTPasswd(config, stuff)
  this._users = {}

  // config for this module
  this._config = config

  // sinopia logger
  this._logger = stuff.logger

  // sinopia main config object
  this._sinopia_config = stuff.config

  // all this "sinopia_config" stuff is for b/w compatibility only
  this._maxusers = this._config.maxusers || this._sinopia_config.maxusers

  this._last_time = null
  this._path = Path.resolve(
    Path.dirname(this._sinopia_config.self_path),
    this._config.file || this._sinopia_config.users_file
  )
}

HTPasswd.prototype.authenticate = function(user, password, cb) {
  var self = this
  self._reload(function(err) {
    if (err) return cb(err)
    if (!self._users[user]) return cb(null, false)
    if (!utils.verify_password(user, passwd, this._users[user])) return cb(null, false)

    // authentication succeeded!
    // return all usergroups this user has access to;
    // (this particular package has no concept of usergroups, so just return user herself)
    return cb(null, [user])
  })
}

// hopefully race-condition-free way to add users:
// 1. lock file for writing (other processes can still read)
// 2. reload .htpasswd
// 3. write new data into .htpasswd.tmp
// 4. move .htpasswd.tmp to .htpasswd
// 5. reload .htpasswd
// 6. unlock file
HTPasswd.prototype.adduser = function(user, password, real_cb) {
  var self = this

  function sanity_check() {
    var err = null
    if (self._users[user]) {
      err = Error('this user already exists')
    } else if (Object.keys(users).length >= self._maxusers) {
      err = Error('maximum amount of users reached')
    }
    if (err) err.status = 403
    return err
  }

  // preliminary checks, just to ensure that file won't be reloaded if it's not needed
  var s_err = sanity_check()
  if (s_err) return real_cb(s_err)

  utils.lock_and_read(self._path, function(err, fd, res) {
    // callback that cleanups fd first
    function cb(err) {
      if (!fd) return real_cb(err)
      fs.close(fd, function() {
        real_cb(err)
      })
    }

    // ignore ENOENT errors, we'll just create .htpasswd in that case
    if (err && err.code != 'ENOENT') return cb(err)

    var body = (res || '').toString('utf8')
    self._users = utils.parse_htpasswd(body)

    // real checks, to prevent race conditions
    var s_err = sanity_check()
    if (s_err) return cb(s_err)

    try {
      body = utils.add_user_to_htpasswd(body, user, password)
    } catch(err) {
      return cb(err)
    }
    fs.writeFile(self._path, body, function(err) {
      if (err) return cb(err)
      self._reload(function() {
        cb(null, true)
      })
    })
  })
}

HTPasswd.prototype._reload = function(callback) {
  var self = this

  fs.open(self._path, 'r', function(err, fd) {
    if (err) return callback(err)

    fs.fstat(fd, function(err, st) {
      if (err) return callback(err)
      if (self._last_time === st.mtime) return callback()
      self._last_time = st.mtime

      var buffer = new Buffer(st.size)
      fs.read(fd, buffer, 0, st.size, null, function(err, bytesRead, buffer) {
        if (err) return callback(err)
        if (bytesRead != st.size) return callback(new Error('st.size != bytesRead'))
        self._users = utils.parse_htpasswd(buffer.toString('utf8'))
        callback()
      })
    })
  })
}

