export default class RandomMessageProvider {
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	#registry: ((...args: any) => string)[] = [];

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	add(messageCreator: (...args: any) => string) {
		this.#registry.push(messageCreator);
		return this;
	}

	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	any(...args: any) {
		const messageCreator = this.#registry[Math.floor(Math.random() * this.#registry.length)];
		return messageCreator(...args);
	}
}
