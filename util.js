const sleep_ms = module.exports.sleep_ms = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const try_until = module.exports.try_until = async (doWhat, untilWhat) => {
	let done = false;
	return Promise.all([
		(async () => {
			while (!done) {
				await doWhat();
				await sleep_ms(1000);
			}
		})(),
		(async () => {
			await untilWhat();
			done = true;
		})(),
	]);
};
