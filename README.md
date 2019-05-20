# LatteBot
A simple channel subscription bot. Can also give you information about topics you want.

This bot was created in beginning of 2018. I do not guarantee that all the APIs are working.

## Installation
 * clone this project
 * have `node`, `npm` and `redis` installed
 * install packages by running `npm install` in the project directory
 * copy `auth.example.json` to `auth.json` and update it with your own Discord bot API key (and a Bing Translation API key if you want to use that)
 * you are all set!

## Usage
Just run `./bot.js` (or `node bot.js` if `node` is not in your env)

Simple daemonization using `screen`: `screen -d -m bash -c "while true; do ./bot.js; done"`
