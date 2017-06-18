'use strict'

const allStops = require('vbb-stations/full.json')
const Bot = require('node-telegram-bot-api')
const vbb = require('vbb-client')
const hafas = require('vbb-hafas')
const timezone = require('moment-timezone')
const ms = require('ms')

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

const renderTime = (when) => timezone(when).tz(TIMEZONE).format('LT')

const renderJourney = (j) => {
	const dep = new Date(j.departure)
	const arr = new Date(j.arrival)
	return [
		renderTime(dep), '–', renderTime(arr),
		'(' + ms(arr - dep) + ')'
	].join(' ')
}

const bot = new Bot(TOKEN, {polling: true})
const data = {}

bot.on('message', (msg) => {
	const user = msg.chat.id
	const text = msg.text
	if (!data[user]) data[user] = {state: 0}
	const d = data[user]

	if (d.state === 0) {
		bot.sendMessage(user, 'Hey! Please tell me where you are.')
		d.state = 1
	} else if (d.state === 1) {
		vbb.stations({
			query: text, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		.then((stations) => {
			bot.sendMessage(user, 'I found ' + stations[0].name)
			d.from = stations[0].id

			d.state = 2
			bot.sendMessage(user, 'Where do you want to go?')
		})
		.catch((err) => {
			bot.sendMessage(user, 'Oops!' + (err.message || err))
		})
	} else if (d.state === 2) {
		vbb.stations({
			query: text, results: 1,
			identifier: 'https://github.com/derhuerst/vbb-get-off-bot'
		})
		.then((stations) => {
			bot.sendMessage(user, 'I found ' + stations[0].name)
			d.to = stations[0].id

			return hafas.journeys(d.from, d.to, {
				results: 10,
				when: Date.now(),
				transfers: 0 // todo
			})
		})
		.then((journeys) => {
			d.journeys = journeys
			bot.sendMessage(user, 'Which journey?')
			// for (let [variant, line] of journeys) {
			for (let i = 0; i < journeys.length; i++) {
				const j = journeys[i]
				bot.sendMessage(user, i + ' – ' + renderJourney(j))
			}
			d.state = 3
		})
		.catch((err) => {
			console.error(err)
			bot.sendMessage(user, 'Oops!' + (err.message || err))
		})
	} else if (d.state === 3) {
		const journey = d.journeys[parseInt(text)]
		if (!journey) return bot.sendMessage(user, 'Oops! No journey found. Try again!')

		// todo: support more than one part
		d.id = journey.parts[0].id
		d.name = journey.parts[0].name // todo: support more than one part
		d.state = 0

		// todo: start watcher
		const watcher = findArrival(d.id, d.name, d.to, (timeLeft) => {
			if (timeLeft < 0) watchers.stop(user)
			else bot.sendMessage(user, `You need to get off in ${ms(timeLeft)}.`)
		})
		watchers.start(user, watcher)
	}
})
