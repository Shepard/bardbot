// Limit for characters in the description of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
export const EMBED_DESCRIPTION_CHARACTER_LIMIT = 4096;

// Limit for characters in a field value of an embed.
// See https://discord.com/developers/docs/resources/channel#embed-limits
export const EMBED_FIELD_VALUE_CHARACTER_LIMIT = 1024;

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
