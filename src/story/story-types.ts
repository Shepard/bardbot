// TODO typings: revisit this. I want the type definitions. might have to adjust inkjs ts support.
import { Story } from '@shepard4711/inkjs/engine/Story.js';
import { Choice } from '@shepard4711/inkjs/engine/Choice.js';
import { VariablesState } from '@shepard4711/inkjs/engine/VariablesState.js';
import { HexColorString } from 'discord.js';
import { StoryRecord, StorySuggestion } from '../storage/record-types.js';

export interface StoryMetadata {
	title: string;
	author: string;
	teaser: string;
}

export type StoryCharacter = {
	id: string;
	name: string;
	imageUrl?: string;
	colour?: HexColorString;
};

export type StoryData = { inkStory: Story; storyRecord: StoryRecord };

export interface StepData {
	lines: StoryLine[];
	choices: Choice[];
	warnings?: string[];
	errors?: string[];
	isEnd?: boolean;
	suggestions?: StorySuggestion[];
}

export type StoryLine = {
	text: string;
	tags: string[];
};

export interface EnhancedStepData extends StepData {
	storyRecord: StoryRecord;
	characters: Map<string, StoryCharacter>;
	defaultButtonStyle: ChoiceButtonStyle;
	variablesState?: VariablesState;
}

export type CharacterImageSize = 'small' | 'medium' | 'large';

export interface LineSpeech {
	text: string;
	character: StoryCharacter;
	characterImageSize: CharacterImageSize;
}

export type ChoiceButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | '';

export interface ChoiceAction {}

export interface InputChoiceAction extends ChoiceAction {
	input: Input;
}

export function isInputChoiceAction(action: ChoiceAction): action is InputChoiceAction {
	return (action as InputChoiceAction).input !== undefined;
}

export interface Input {
	type: 'text'; // To be extended in the future; possibly with multiline-text
	variableName: string;
}

export type StoryProbe = {
	stepData: StepData;
	metadata: StoryMetadata;
};

export enum StoryErrorType {
	StoryNotFound = 'StoryNotFound',
	AlreadyPlayingDifferentStory = 'AlreadyPlayingDifferentStory',
	StoryNotStartable = 'StoryNotStartable',
	NoStoryRunning = 'NoStoryRunning',
	StoryNotContinueable = 'StoryNotContinueable',
	TemporaryProblem = 'TemporaryProblem',
	InvalidChoice = 'InvalidChoice',
	CouldNotSaveState = 'CouldNotSaveState',
	TimeBudgetExceeded = 'TimeBudgetExceeded'
}

export class StoryEngineError extends Error {
	storyErrorType: string;

	constructor(storyErrorType: string, m?: string) {
		super(m);
		this.storyErrorType = storyErrorType;
		Object.setPrototypeOf(this, StoryEngineError.prototype);
	}
}
