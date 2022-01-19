The "en-GB.json5" file will always be kept empty (apart from the language name).
The translations provided for "en" are written in British English and only deviations from this for American English are stored in the "en-US.json5" file.
The "en-GB.json5" file only exists so that i18next finds something to load without complaining and we can support "en-GB", but it will _always_ fall back to "en".
