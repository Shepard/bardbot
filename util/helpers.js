export function chunk(items, chunkSize) {
	const chunked = [];
	for (let i = 0; i < items.length; i += chunkSize) {
		chunked.push(items.slice(i, i + chunkSize));
	}
	return chunked;
}

export function addMonths(inputDate, months) {
	const date = new Date(inputDate);
	date.setDate(1);
	date.setMonth(date.getMonth() + months);
	date.setDate(Math.min(inputDate.getDate(), getDaysInMonth(date.getFullYear(), date.getMonth() + 1)));
	return date;
}

function getDaysInMonth(year, month) {
	return new Date(year, month, 0).getDate();
}

export function codePointLength(s) {
	let i = 0;
	/* eslint-disable no-unused-vars */
	for (let c of s) {
		i++;
	}
	return i;
}
