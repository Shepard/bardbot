# Bard Bot

A Discord bot for supporting role-playing servers.

[End user documentation](https://github.com/Shepard/bardbot/wiki)

## Running the bot yourself

- Create a Discord application and bot. You can [follow this tutorial](https://discordjs.guide/preparations/setting-up-a-bot-application.html).
- Add your bot to at least one server. [There's a tutorial](https://discordjs.guide/preparations/adding-your-bot-to-servers.html) for that too. The permissions I used in the invite link are 535263968320. Those are not the minimal permissions needed but they work.
- Make sure to have at least Node v16.9.0 or higher installed. Also your NPM version needs to be at least 7 (should come with Node).
- Clone this repository.
- Set up a config file (see below).
- In a terminal in the main directory run `npm run upgrade` initially and every time you pull new changes from this repository.
  - This will install all code dependencies, build the code of the bot, and also connect the bot to Discord to register its commands. You can run each of these steps individually later on, if you wish - for example if you add a command of your own and want to register that.
  - For some of the dependencies of this project you might need additional tools for compiling native code. In particular, you might need to install [node-gyp](https://github.com/nodejs/node-gyp) if you're working on a Windows machine.
- To start the bot, run `npm run start`.
  - For a more permanent setup for starting and managing the bot, I recommend using a Node process manager like [pm2](https://pm2.keymetrics.io/).
- [Configure the bot on your server](https://github.com/Shepard/bardbot/wiki/User-Guide#configuring-the-bot-on-a-server) using the `/config` command.

### Setting up a config file

- Copy the `config.example.json` file and rename the copy to `config.json`.
- In that file, replace the text `Client id of your app` with the client id of your application. This is the "Application Id" on the "General Information" page of the application you created.
- Replace the text `Secret authentication token of your bot` with the token of your bot. You can find this token on the "Bot" page of the application you created. Don't give this token to anyone!

### Upgrading

To get the latest version of the code and deploy it:

- Stop the bot if it's running.
- Run `git pull`.
- Run `npm run upgrade`.
- Start the bot again.

## Development

### Running

- `npm run build` will transpile the TypeScript sources to JavaScript. From there, you can the transpiled files using `npm run start`.
- Alternatively, `npm run tsstart` will do both at once. It takes a bit longer to start the bot this way since it still transpiles the files in the background. But you only have to run one command instead of two. And any error stacktraces in the log will point to the TypeScript sources rather than the transpiled JavaScript files.

### Linting and formatting

All files should be run through linting and formatting before being checked in, to ensure consistency and prevent common issues.

Linting is done via ESLint.
`npm run lint` will run the linter. Make sure to fix any problems it reports or ignore them using eslint comments if necessary.
I recommend using an ESLint plugin for your IDE to see live warnings while editing a code file.

For formatting, this project uses Prettier.
`npm run format` will automatically format all files in the project.
I also recommend using a Prettier plugin for your IDE though, so you can set it up to automatically format a file on saving it.

### Testing

`npm run test` will execute all tests.

The tests can be found in `/test` and are currently written in JavaScript (to be converted to TypeScript in the future). Feel free to extend them when adding new features.
