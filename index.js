'use strict'

const allStops = require('vbb-stations/full.json')
const Bot = require('node-telegram-bot-api')
const vbb = require('vbb-client')
const hafas = require('vbb-hafas')
const timezone = require('moment-timezone')
const ms = require('ms')
const createResponder = require('chatbot-coroutine')
const inMemStorage = require('chatbot-coroutine/in-mem-storage')

const watchers = require('./lib/watchers')

const TOKEN = process.env.TOKEN
if (!TOKEN) {
	console.error('Missing TOKEN env var.')
	process.exit(1)
}

const TIMEZONE = process.env.TIMEZONE
if (!TIMEZONE) {
	console.error('Missing TIMEZONE env var.')
	process.exit(1)
}

const stationsOf = {}
for (let id in allStops) {
	stationsOf[id] = id
	for (let stop of allStops[id].stops)
	stationsOf[stop.id] = id
}

const success = `\
I will regularly watch for delays to let you know at the right time.

Keep in mind that this bot may still have bugs, so don't rely on it (yet).`

const findArrival = (id, name, station, cb) => () => {
	return hafas.journeyDetails(id, name)
	.then((journey) => {
		for (let stopover of journey.passed) {
			if (stopover.station.id === station) return stopover.arrival
		}
		return null
	})
	.then((arrival) => {
		const d = new Date(arrival) - Date.now()
		if (d < 60 * 1000) cb(d) // todo: make use of delay information
	})
	.catch((err) => {
		console.error(err)
	})
}

const renderTime = (when) => {
	return timezone(when).locale(LOCALE).tz(TIMEZONE).format('LT')
}

const renderRelative = (when) => {
	const now = Date.now()
	if (now > when) return ms(now - when) + ' ago'
	return 'in ' + ms(when - now)
}

const renderJourney = (j) => {
	const dep = new Date(j.departure)
	const arr = new Date(j.arrival)
	return [
		renderRelative(dep),
		ms(arr - dep) + ' travel',
		renderTime(dep) + ' – ' + renderTime(arr)
	].join(', ')
}

const conversation = function* (ctx, user) {
	let from = yield ctx.read('from')
	if (!from) {
		const query = yield ctx.prompt('Hey! Please tell me where you are.')
		const results = yield vbb.stations({
			query, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		from = results[0]
		yield ctx.send('I found ' + from.name)
		yield ctx.write('from', from)
	}

	let to = yield ctx.read('to')
	if (!to) {
		const query = yield ctx.prompt('Where do you want to go?')
		const results = yield vbb.stations({
			query, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		to = results[0]
		yield ctx.send('I found ' + to.name)
		yield ctx.write('to', to)
	}

	let journey = yield ctx.read('journey')
	if (!journey) {
		const journeys = yield hafas.journeys(from.id, to.id, {
			results: 10,
			when: Date.now(),
			transfers: 0 // todo
		})

		for (let i = 0; i < journeys.length; i++) {
			ctx.send(i + ' – ' + renderJourney(journeys[i]))
		}

		let input = yield ctx.prompt('Which journey?')
		journey = journeys[parseInt(input)]
		while (!journey) {
			input = yield ctx.prompt('No journey found. Try again!')
			journey = journeys[parseInt(input)]
		}
		yield ctx.write('journey', journey)
	}

	// todo: support more than one part
	const id = journey.parts[0].id
	const name = journey.parts[0].name

	const watcher = findArrival(id, name, to, (timeLeft) => {
		// what about promises in callbacks?
		// todo: handle errors
		if (timeLeft < 0) watchers.stop(user)
		else ctx.send(`You need to get off in ${ms(timeLeft)}.`)
	})
	watchers.start(user, watcher)
	yield ctx.send(success)

	yield ctx.clear()
}

const bot = new Bot(TOKEN, {polling: true})
bot.on('message', (msg) => respond(msg.chat.id, msg.text))

const telegram = Object.assign(Object.create(bot), {
	send: bot.sendMessage.bind(bot)
})

const onError = (user, err) => {
	console.error(err)
	bot.sendMessage(user, 'oops! an error occured.')
}

// todo: use levelDBStorage
const respond = createResponder(inMemStorage, telegram, conversation, onError)
