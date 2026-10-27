'use strict';
/**
 * 百衲被背景音乐：WebAudio 现场合成的八音盒小曲，不需要音频文件。浏览器和小游戏共用。
 * 8 小节一轮（C G Am Em F C F G），旋律两段轮流：A 段、间奏、B 段、间奏……约 107 秒才完全重复一次。
 * 间奏只留分解和弦和几声高音，听久了不腻。
 */
(function (root) {
	const BPM = 72;
	const BEAT = 60 / BPM;
	const BAR_BEATS = 4;
	const LOOKAHEAD = 0.6; // 提前排多少秒的音
	const TICK_MS = 150;
	const VOLUME = 0.18;
	const FADE = 0.8;
	const DUCK_LEVEL = 0.3;
	// 每小节：低音、分解和弦的四个音（midi）
	const BARS = [
		{ bass: 48, chord: [60, 64, 67, 72] }, // C
		{ bass: 55, chord: [55, 59, 62, 67] }, // G
		{ bass: 57, chord: [57, 60, 64, 69] }, // Am
		{ bass: 52, chord: [55, 59, 64, 67] }, // Em
		{ bass: 53, chord: [57, 60, 65, 69] }, // F
		{ bass: 48, chord: [60, 64, 67, 72] }, // C
		{ bass: 53, chord: [57, 60, 65, 69] }, // F
		{ bass: 55, chord: [55, 59, 62, 67] }, // G
	];
	// 低音不低于 C3（130Hz），手机外放也听得到
	// 旋律：[小节, 拍, midi, 拍数]，以五声音阶为主，落在和弦音上不刺耳
	const MELODY_A = [
		[0, 0, 76, 1.5], [0, 1.5, 74, 0.5], [0, 2, 72, 2],
		[1, 0, 74, 1], [1, 1, 67, 1], [1, 2, 74, 1], [1, 3, 76, 1],
		[2, 0, 72, 2], [2, 2, 69, 2],
		[3, 0, 67, 3],
		[4, 0, 69, 1], [4, 1, 72, 1], [4, 2, 74, 1], [4, 3, 72, 1],
		[5, 0, 76, 2], [5, 2, 79, 2],
		[6, 0, 81, 1.5], [6, 1.5, 79, 0.5], [6, 2, 77, 1], [6, 3, 72, 1],
		[7, 0, 74, 3],
	];
	const MELODY_B = [
		[0, 0, 79, 1], [0, 1, 76, 1], [0, 2, 72, 1.5], [0, 3.5, 74, 0.5],
		[1, 0, 74, 2], [1, 2, 71, 1], [1, 3, 67, 1],
		[2, 0, 69, 1], [2, 1, 72, 1], [2, 2, 76, 2],
		[3, 0, 71, 1.5], [3, 1.5, 67, 2.5],
		[4, 0, 72, 1], [4, 1, 69, 1], [4, 2, 65, 2],
		[5, 0, 67, 1], [5, 1, 72, 1], [5, 2, 76, 1], [5, 3, 79, 1],
		[6, 0, 77, 1.5], [6, 1.5, 76, 0.5], [6, 2, 72, 2],
		[7, 0, 74, 1], [7, 1, 71, 1], [7, 2, 67, 2],
	];
	const MELODIES = [MELODY_A, null, MELODY_B, null]; // null = 间奏
	const ARP = [0, 1, 2, 3, 2, 1, 2, 1]; // 每小节八个八分音符

	const hz = midi => 440 * Math.pow(2, (midi - 69) / 12);

	function createMusic(ctx) {
		let master = null;
		let timer = null;
		let nextBar = 0; // 下一个要排的小节（从开始算的总序号）
		let barTime = 0; // 这个小节开始的时间

		/** 一个音：正弦基音 + 一点二倍泛音，敲一下慢慢散掉，像八音盒。 */
		function bell(midi, t, gain, decay, overtone = 0.25) {
			const f = hz(midi);
			const g = ctx.createGain();
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
			g.gain.exponentialRampToValueAtTime(0.0001, t + decay);
			g.connect(master);
			[[f, 1], [f * 2, overtone]].forEach(([freq, level]) => {
				if (!level) return;
				const osc = ctx.createOscillator();
				const lg = ctx.createGain();
				osc.type = 'sine';
				osc.frequency.setValueAtTime(freq, t);
				lg.gain.value = level;
				osc.connect(lg);
				lg.connect(g);
				osc.start(t);
				osc.stop(t + decay + 0.05);
			});
		}

		function bass(midi, t) {
			const osc = ctx.createOscillator();
			const g = ctx.createGain();
			osc.type = 'triangle';
			osc.frequency.setValueAtTime(hz(midi), t);
			g.gain.setValueAtTime(0.0001, t);
			g.gain.exponentialRampToValueAtTime(0.24, t + 0.04);
			g.gain.exponentialRampToValueAtTime(0.0001, t + BEAT * BAR_BEATS);
			osc.connect(g);
			g.connect(master);
			osc.start(t);
			osc.stop(t + BEAT * BAR_BEATS + 0.05);
		}

		function scheduleBar(index, t) {
			const bar = BARS[index % BARS.length];
			const melody = MELODIES[Math.floor(index / BARS.length) % MELODIES.length];
			bass(bar.bass, t);
			ARP.forEach((k, i) => bell(bar.chord[k], t + i * BEAT / 2, i === 0 ? 0.13 : 0.08, 1.1, 0.15));
			if (melody) {
				melody.filter(m => m[0] === index % BARS.length)
					.forEach(([, beat, midi, len]) => bell(midi, t + beat * BEAT, 0.3, Math.max(1.2, len * BEAT * 1.2)));
			} else if (index % 2 === 0) {
				bell(bar.chord[3] + 12, t + 2 * BEAT, 0.12, 2);
			}
		}

		function tick() {
			while (barTime < ctx.currentTime + LOOKAHEAD) {
				scheduleBar(nextBar, barTime);
				nextBar += 1;
				barTime += BEAT * BAR_BEATS;
			}
		}

		function rampTo(value, seconds) {
			const now = ctx.currentTime;
			master.gain.cancelScheduledValues(now);
			master.gain.setValueAtTime(master.gain.value, now);
			master.gain.linearRampToValueAtTime(value, now + seconds);
		}

		return {
			get playing() { return timer !== null; },
			start() {
				if (timer !== null) return;
				// 每次开始换一个新的总音量：上一次提前排好的音跟着旧的淡出断开，不和新的叠在一起
				master = ctx.createGain();
				master.gain.value = 0;
				master.connect(ctx.destination);
				nextBar = 0;
				barTime = ctx.currentTime + 0.1;
				rampTo(VOLUME, FADE);
				tick();
				timer = setInterval(tick, TICK_MS);
			},
			stop() {
				if (timer === null) return;
				clearInterval(timer);
				timer = null;
				rampTo(0, 0.3);
				const old = master;
				setTimeout(() => old.disconnect(), 400);
			},
			/** 过关音效响的时候把音乐压低，过几秒再回来。 */
			duck(seconds) {
				if (timer === null) return;
				const now = ctx.currentTime;
				master.gain.cancelScheduledValues(now);
				master.gain.setValueAtTime(master.gain.value, now);
				master.gain.linearRampToValueAtTime(VOLUME * DUCK_LEVEL, now + 0.15);
				master.gain.setValueAtTime(VOLUME * DUCK_LEVEL, now + seconds);
				master.gain.linearRampToValueAtTime(VOLUME, now + seconds + 1.2);
			},
		};
	}

	const api = { createMusic };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.QuiltMusic = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
