# Bard Bot

A Discord bot for supporting roleplaying servers.

## Running the bot yourself

* Create a Discord application and bot. You can [follow this tutorial](https://discordjs.guide/preparations/setting-up-a-bot-application.html).
* Add your bot to at least one server. [There's a tutorial](https://discordjs.guide/preparations/adding-your-bot-to-servers.html) for that too.
* Make sure to have at least Node v16.6.0 or higher installed. Also your NPM version needs to be at least 7 (should come with Node).
* Clone this repository.
* In a terminal in the main directory run `npm install --no-save` initially and every time you pull new changes from this repository.
* Set up a config file (see below).
* To start the bot, run `npm run start`.
* For a more permanent setup for starting and managing the bot I recommend using a Node process manager like [pm2](https://pm2.keymetrics.io/).

### Setting up a config file

* Copy the `config.example.json` file and rename the copy to `config.json`.
* In that file, replace the text `Client id of your app` with the client id of your application. This is the "Application Id" on the "General Information" page of the application you created.
* Replace the text `Secret authentication token of your bot` with the token of your bot. You can find this token on the "Bot" page of the application you created. Don't give this token to anyone!
* For now, all guilds (= Discord servers) that the bot is supposed to be used in need to be configured in this file as well.
  * There is a list of guilds in the JSON with one object for every guild. The example file lists objects for two guilds to show you how the structure would look but if you only have one guild then you can delete the second object and the trailing comma.
  * For every guild you need to find and fill in its id and optionally also the ids of a bookmark and a quotes channel if you want to use those two features in that guild. In order to find these, open Discord and go to your settings. On the "Advanced" page, turn on "Developer Mode". This will enable a "Copy ID" button in the context menu when you right-click on a server icon, a channel or a user.
  * If you don't want to use bookmark or quotes channels you can delete the lines for them. Make sure not to have any trailing commas.
  * If you want to make it easier to identify which guild is which you can add a line like `"name": "My Server",` to a guild's config object. The bot will just ignore it.
