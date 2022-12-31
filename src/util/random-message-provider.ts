export default class RandomMessageProvider {
	#registry: ((...args: any) => string)[] = [];

	add(messageCreator: (...args: any) => string) {
		this.#registry.push(messageCreator);
		return this;
	}

	any(...args: any) {
		const messageCreator = this.#registry[Math.floor(Math.random() * this.#registry.length)];
		return messageCreator(...args);
	}
}
