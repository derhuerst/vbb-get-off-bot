'use strict'

const watchers = {} // todo: persistence

const start = (user, cb) => {
	watchers[user] = setInterval(cb, 10 * 1000)
}

const stop = (user) => {
	clearInterval(watchers[user])
	watchers[user] = null
}

module.exports = {start, stop}
