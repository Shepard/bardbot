// See https://discord.com/developers/docs/resources/channel#create-message-jsonform-params
export const MESSAGE_CONTENT_CHARACTER_LIMIT = 2000;

// Limit for characters in the description of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
export const EMBED_DESCRIPTION_CHARACTER_LIMIT = 4096;

// Limit for characters in a field value of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
export const EMBED_FIELD_VALUE_CHARACTER_LIMIT = 1024;

// See https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-messages
export const EMBEDS_PER_MESSAGE_LIMIT = 10;

// See https://discord.com/developers/docs/resources/webhook#create-webhook
export const WEBHOOK_NAME_CHARACTER_LIMIT = 80;

// See https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-structure
// and https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-structure
export const COMMAND_NAME_CHARACTER_LIMIT = 32;

// See https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-structure
// and https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-structure
export const COMMAND_DESCRIPTION_CHARACTER_LIMIT = 100;

// See https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-option-choice-structure
export const COMMAND_OPTION_CHOICE_NAME_CHARACTER_LIMIT = 100;

// See https://discord.com/developers/docs/interactions/application-commands#application-command-object-application-command-naming
export const COMMAND_NAME_REGEXP = /^[-_\p{L}\p{N}\p{sc=Deva}\p{sc=Thai}]{1,32}$/u;

// See https://discord.com/developers/docs/interactions/receiving-and-responding#interaction-response-object-autocomplete
export const AUTOCOMPLETE_CHOICE_LIMIT = 25;

// See https://discord.com/developers/docs/interactions/message-components#select-menu-object-select-menu-structure
export const SELECT_CHOICE_LIMIT = 25;

// See https://discord.com/developers/docs/interactions/message-components#component-object-component-structure
export const BUTTON_LABEL_CHARACTER_LIMIT = 80;

// See https://discord.com/developers/docs/interactions/message-components#action-rows
export const MESSAGE_ACTION_ROW_LIMIT = 5;

// See https://discord.com/developers/docs/interactions/message-components#buttons
export const ACTION_ROW_BUTTON_LIMIT = 5;

export const COLOUR_DISCORD_RED = 0xed4245; //0xeb2b2e;
export const COLOUR_DISCORD_YELLOW = 0xcb8515;
