// TODO typings: revisit this. I want the type definitions. might have to adjust inkjs ts support.
import { Story } from '@shepard4711/inkjs/engine/Story.js';
import { Choice } from '@shepard4711/inkjs/engine/Choice.js';
import { HexColorString } from 'discord.js';
import { StoryRecord } from '../storage/record-types.js';

export interface StoryMetadata {
	title: string;
	author: string;
	teaser: string;
}

export type StoryCharacter = {
	name: string;
	iconUrl?: string;
	colour?: HexColorString;
};

export type StoryData = { inkStory: Story; storyRecord: StoryRecord };

export interface StepData {
	lines: StoryLine[];
	choices: Choice[];
	warnings?: string[];
	errors?: string[];
	isEnd?: boolean;
}

export type StoryLine = {
	text: string;
	tags: string[];
};

export interface EnhancedStepData extends StepData {
	storyRecord: StoryRecord;
	characters: Map<string, StoryCharacter>;
	defaultButtonStyle: ChoiceButtonStyle;
}

export type ChoiceButtonStyle = 'primary' | 'secondary' | 'success' | 'danger' | '';

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
