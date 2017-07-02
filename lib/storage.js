'use strict'

const level = require('level')
const levelDBStorage = require('chatbot-coroutine/leveldb-storage')

const DB = process.env.DB
if (!DB) {
	console.error('Missing DB env var.')
	process.exit(1)
}

const db = level(DB, {valueEncoding: 'json'})
const storage = levelDBStorage(db)

module.exports = storage
