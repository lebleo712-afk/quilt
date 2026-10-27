'use strict';
/**
 * 百衲被核心逻辑：出题、唯一解校验、推理深度、最少步数、提示。浏览器和 Node（测试）共用。
 * 布块 = [上, 右, 下, 左] 四边花纹，0 表示被子外沿，1..colors 是花纹。
 * 盘面 perm[pos] = 当前放在 pos 位置的布块编号；perm[pos] === pos 即放对。
 */
(function (root) {
	const BORDER = 0;
	const MAX_COLORS = 5;
	const MAX_ATTEMPTS = 4000;

	/** mulberry32：给定种子每次得到同一串随机数，保证所有人的每日题一样。 */
	function makeRng(seed) {
		let a = seed >>> 0;
		return () => {
			a = (a + 0x6d2b79f5) >>> 0;
			let t = a;
			t = Math.imul(t ^ (t >>> 15), t | 1);
			t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
			return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
		};
	}

	function hashString(s) {
		let h = 2166136261;
		for (const ch of String(s)) {
			h ^= ch.codePointAt(0);
			h = Math.imul(h, 16777619);
		}
		return h >>> 0;
	}

	function randInt(rand, n) {
		return Math.floor(rand() * n);
	}

	function shuffle(rand, arr) {
		const out = arr.slice();
		for (let i = out.length - 1; i > 0; i--) {
			const j = randInt(rand, i + 1);
			[out[i], out[j]] = [out[j], out[i]];
		}
		return out;
	}

	/** 先随机给每条内部接缝分配花纹，拼出一床完整的被子。 */
	function solvedTiles(n, rand, colors) {
		const h = Array.from({ length: n }, () => Array.from({ length: n - 1 }, () => 1 + randInt(rand, colors)));
		const v = Array.from({ length: n - 1 }, () => Array.from({ length: n }, () => 1 + randInt(rand, colors)));
		const tiles = [];
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				tiles.push([
					r === 0 ? BORDER : v[r - 1][c],
					c === n - 1 ? BORDER : h[r][c],
					r === n - 1 ? BORDER : v[r][c],
					c === 0 ? BORDER : h[r][c - 1],
				]);
			}
		}
		return tiles;
	}

	function allDistinct(tiles) {
		return new Set(tiles.map(t => t.join(','))).size === tiles.length;
	}

	/** 布块 tile 能不能放在 pos：和上方、左方已放的布块对上，外沿只能朝外。 */
	function fits(tile, pos, n, grid) {
		const r = Math.floor(pos / n);
		const c = pos % n;
		const top = r === 0 ? BORDER : grid[pos - n][2];
		const left = c === 0 ? BORDER : grid[pos - 1][1];
		if (tile[0] !== top || tile[3] !== left) return false;
		if ((tile[1] === BORDER) !== (c === n - 1)) return false;
		if ((tile[2] === BORDER) !== (r === n - 1)) return false;
		return true;
	}

	/** 回溯求解，数到 limit 个解就停。用来确认整床被子只有一种拼法。 */
	function countSolutions(tiles, n, limit = 2) {
		const used = new Array(tiles.length).fill(false);
		const grid = [];
		let count = 0;
		(function place(pos) {
			if (count >= limit) return;
			if (pos === tiles.length) {
				count++;
				return;
			}
			for (let i = 0; i < tiles.length; i++) {
				if (used[i] || !fits(tiles[i], pos, n, grid)) continue;
				used[i] = true;
				grid[pos] = tiles[i];
				place(pos + 1);
				used[i] = false;
			}
		})(0);
		return count;
	}

	/**
	 * 推理难度（known 是开局就能确认放对的位置）：模拟人怎么推——只用外沿、四周已放好的邻居、「这块布只能放一个地方」三条规则往下推，
	 * 推不动时就得试一次（这里按正确答案放下去继续推）。返回要试的次数，0 表示一路推得出来。
	 */
	function guessCount(tiles, n, known = []) {
		const size = n * n;
		const place = new Array(size).fill(-1);
		const used = new Array(size).fill(false);
		const ok = (t, pos) => {
			const r = Math.floor(pos / n), c = pos % n, e = tiles[t];
			if ((e[0] === BORDER) !== (r === 0) || (e[1] === BORDER) !== (c === n - 1)) return false;
			if ((e[2] === BORDER) !== (r === n - 1) || (e[3] === BORDER) !== (c === 0)) return false;
			if (r > 0 && place[pos - n] >= 0 && tiles[place[pos - n]][2] !== e[0]) return false;
			if (r < n - 1 && place[pos + n] >= 0 && tiles[place[pos + n]][0] !== e[2]) return false;
			if (c > 0 && place[pos - 1] >= 0 && tiles[place[pos - 1]][1] !== e[3]) return false;
			if (c < n - 1 && place[pos + 1] >= 0 && tiles[place[pos + 1]][3] !== e[1]) return false;
			return true;
		};
		const put = (pos, t) => { place[pos] = t; used[t] = true; };
		known.forEach(pos => put(pos, pos));
		let guesses = 0;
		let filled = known.length;
		while (filled < size) {
			let progressed = false;
			let tightest = null;
			for (let pos = 0; pos < size; pos++) {
				if (place[pos] >= 0) continue;
				const cands = [];
				for (let t = 0; t < size; t++) if (!used[t] && ok(t, pos)) cands.push(t);
				if (cands.length === 1) {
					put(pos, cands[0]);
					filled++;
					progressed = true;
				} else if (!tightest || cands.length < tightest.k) {
					tightest = { pos, k: cands.length };
				}
			}
			if (progressed) continue;
			for (let t = 0; t < size; t++) {
				if (used[t]) continue;
				const spots = [];
				for (let pos = 0; pos < size; pos++) if (place[pos] < 0 && ok(t, pos)) spots.push(pos);
				if (spots.length === 1) {
					put(spots[0], t);
					filled++;
					progressed = true;
				}
			}
			if (progressed) continue;
			guesses++;
			put(tightest.pos, tightest.pos);
			filled++;
		}
		return guesses;
	}

	/** 盘面上四边全对上（缝线和外沿都对）的位置。 */
	function fullySewn(tiles, perm, n) {
		const seams = new Set(matchedSeams(tiles, perm, n).map(s => `${s.dir}${s.r}-${s.c}`));
		const out = [];
		for (let pos = 0; pos < n * n; pos++) {
			const r = Math.floor(pos / n), c = pos % n, e = tiles[perm[pos]];
			if ((e[0] === BORDER) !== (r === 0) || (e[1] === BORDER) !== (c === n - 1)) continue;
			if ((e[2] === BORDER) !== (r === n - 1) || (e[3] === BORDER) !== (c === 0)) continue;
			const sides = [
				r === 0 || seams.has(`v${r - 1}-${c}`),
				c === n - 1 || seams.has(`h${r}-${c}`),
				r === n - 1 || seams.has(`v${r}-${c}`),
				c === 0 || seams.has(`h${r}-${c - 1}`),
			];
			if (sides.every(Boolean)) out.push(pos);
		}
		return out;
	}

	/** 开局就能确认的布：四边全对上的位置。玩家会把它们当已知（出题时保证它们确实放对了）。 */
	function knownAtStart(tiles, perm, n) {
		return fullySewn(tiles, perm, n).filter(pos => perm[pos] === pos);
	}

	/** 每种花纹占内部接缝的比例都在 [lo, hi] 之间，避免满屏一个颜色。 */
	function balanced(tiles, n, colors, [lo, hi]) {
		const counts = new Array(colors + 1).fill(0);
		tiles.forEach((t, i) => {
			if (i % n < n - 1) counts[t[1]]++;
			if (i < n * (n - 1)) counts[t[2]]++;
		});
		const total = seamTotal(n);
		return counts.slice(1).every(k => k / total >= lo && k / total <= hi);
	}

	/** 目标排列唯一且布块互不相同时，最少交换次数 = 放错的块数 − 放错部分的环数。 */
	function minSwaps(perm) {
		const seen = new Array(perm.length).fill(false);
		let swaps = 0;
		for (let i = 0; i < perm.length; i++) {
			if (seen[i]) continue;
			let len = 0;
			for (let j = i; !seen[j]; j = perm[j]) {
				seen[j] = true;
				len++;
			}
			swaps += len - 1;
		}
		return swaps;
	}

	/** 选几块打乱（被打乱的块都离开原位，块数在 moved 范围内），最少步数落在 [lo, hi]。 */
	function scramble(n, rand, [lo, hi], moved = null) {
		const total = n * n;
		const [mLo, mHi] = moved || [lo + 1, Math.min(total, hi + 3)];
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const movedCount = mLo + randInt(rand, mHi - mLo + 1);
			const picked = shuffle(rand, [...Array(total).keys()]).slice(0, movedCount);
			const target = shuffle(rand, picked);
			if (target.some((t, i) => t === picked[i])) continue;
			const perm = [...Array(total).keys()];
			picked.forEach((pos, i) => { perm[pos] = target[i]; });
			const min = minSwaps(perm);
			if (min >= lo && min <= hi) return { perm, min };
		}
		throw new Error('打乱失败');
	}

	/**
	 * 出题。spec = { n, colors, balance: 每种花纹占比, min: 最少步数, moved: 打乱块数, guesses: 开局后要试几次 }。
	 * 保证：布块互不相同、只有一种拼法，所以最少步数公式精确。
	 * 难度按开局的实际盘面算：已经在原位且四边对上的布当作已知，再数还要试几次。
	 */
	const SCRAMBLE_TRIES = 30;
	function makePuzzle(seedText, spec) {
		const { n, colors, guesses, balance, min, moved } = spec;
		if (!(n >= 2 && n <= 6) || !(colors >= 2 && colors <= MAX_COLORS)) throw new Error('题目规格不对');
		const rand = makeRng(hashString(seedText));
		for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
			const tiles = solvedTiles(n, rand, colors);
			if (balance && !balanced(tiles, n, colors, balance)) continue;
			if (!allDistinct(tiles) || countSolutions(tiles, n) !== 1) continue;
			// 空盘都推不到下限的题，怎么打乱也到不了，直接换
			if (guesses && guessCount(tiles, n) < guesses[0]) continue;
			for (let k = 0; k < SCRAMBLE_TRIES; k++) {
				const s = scramble(n, rand, min, moved);
				const sewn = fullySewn(tiles, s.perm, n);
				// 不出「四边看着全对、其实放错」的布，免得开局就骗人
				if (sewn.some(pos => s.perm[pos] !== pos)) continue;
				const g = guessCount(tiles, n, sewn);
				if (guesses && (g < guesses[0] || g > guesses[1])) continue;
				return { n, colors, tiles, start: s.perm, min: s.min, guesses: g };
			}
		}
		throw new Error('出题失败');
	}

	/** 当前盘面上所有对上的内部接缝。dir='h' 指 (r,c) 和右边那块，'v' 指和下面那块。 */
	function matchedSeams(tiles, perm, n) {
		const out = [];
		for (let r = 0; r < n; r++) {
			for (let c = 0; c < n; c++) {
				const t = tiles[perm[r * n + c]];
				if (c < n - 1) {
					const right = tiles[perm[r * n + c + 1]];
					if (t[1] !== BORDER && t[1] === right[3]) out.push({ r, c, dir: 'h' });
				}
				if (r < n - 1) {
					const below = tiles[perm[(r + 1) * n + c]];
					if (t[2] !== BORDER && t[2] === below[0]) out.push({ r, c, dir: 'v' });
				}
			}
		}
		return out;
	}

	function seamTotal(n) {
		return 2 * n * (n - 1);
	}

	function isSolved(perm) {
		return perm.every((t, i) => t === i);
	}

	/** perm 是不是 0..size-1 的一个排列（读存档时校验用）。 */
	function isPermutation(perm, size) {
		if (!Array.isArray(perm) || perm.length !== size) return false;
		const seen = new Set();
		for (const x of perm) {
			if (!Number.isInteger(x) || x < 0 || x >= size || seen.has(x)) return false;
			seen.add(x);
		}
		return true;
	}

	/** 交换后返回新盘面（不改原数组）。 */
	function applySwap(perm, i, j) {
		const next = perm.slice();
		[next[i], next[j]] = [next[j], next[i]];
		return next;
	}

	/**
	 * 提示：给出一对交换，换完至少有一块布到位。
	 * 优先挑「只看已放对的邻居，仍有最多块布像是能放」的位置——那正是玩家最可能卡住的地方。
	 */
	function hintSwap(tiles, perm, n, rand = Math.random) {
		const correct = pos => perm[pos] === pos;
		const looksFit = (t, pos) => {
			const r = Math.floor(pos / n), c = pos % n, e = tiles[t];
			if ((e[0] === BORDER) !== (r === 0) || (e[1] === BORDER) !== (c === n - 1)) return false;
			if ((e[2] === BORDER) !== (r === n - 1) || (e[3] === BORDER) !== (c === 0)) return false;
			if (r > 0 && correct(pos - n) && tiles[pos - n][2] !== e[0]) return false;
			if (r < n - 1 && correct(pos + n) && tiles[pos + n][0] !== e[2]) return false;
			if (c > 0 && correct(pos - 1) && tiles[pos - 1][1] !== e[3]) return false;
			if (c < n - 1 && correct(pos + 1) && tiles[pos + 1][3] !== e[1]) return false;
			return true;
		};
		const wrong = perm.map((t, pos) => pos).filter(pos => !correct(pos));
		if (!wrong.length) return null;
		const score = pos => tiles.filter((t, i) => looksFit(i, pos)).length;
		const scored = wrong.map(pos => ({ pos, k: score(pos) }));
		const top = Math.max(...scored.map(x => x.k));
		const pool = scored.filter(x => x.k === top);
		const pos = pool[randInt(rand, pool.length)].pos;
		return [pos, perm.indexOf(pos)];
	}

	/** 每天同一套关卡，从易到难。所有人每天玩的都一样。 */
	const LEVELS = [
		{ label: '新手', n: 3, colors: 5, min: [3, 3], stars: [2, 6] },
		{ label: '热身', n: 3, colors: 5, min: [3, 4], stars: [2, 6] },
		{ label: '入门', n: 4, colors: 4, guesses: [0, 0], min: [7, 9], stars: [2, 6] },
		{ label: '进阶', n: 5, colors: 4, guesses: [1, 1], balance: [0.15, 0.35], min: [10, 12], stars: [2, 4] },
		{ label: '很难', n: 5, colors: 3, guesses: [2, 3], balance: [0.28, 0.4], min: [12, 15], moved: [17, 21], stars: [4, 8] },
		{ label: '地狱', n: 6, colors: 4, guesses: [3, 4], balance: [0.18, 0.32], min: [19, 22], moved: [24, 27], stars: [4, 10] },
	];
	/**
	 * 加练关「炼狱」：缝完地狱关才解锁，不计入每日六关。要非常难，但不加大棋盘（手机上 6×6 已是极限）：
	 * - 只有 3 种花纹：同一条边能对上的布多得多，「只能放这里」的线索少；
	 * - 推理要试 10~13 次（地狱 3~4 次），只取 3 色题里最难的一成多；再往上（11 次起）出题会慢到手机卡几秒，不取；
	 * - 整床几乎全打乱（33~36 块离位），开局没有现成放对的布可当已知。
	 * 试得越多走得越多，星级余量相应放宽到 10/20。
	 */
	const BONUS = { label: '炼狱', n: 6, colors: 3, guesses: [10, 13], balance: [0.25, 0.42], min: [29, 33], moved: [33, 36], stars: [10, 20] };

	/**
	 * 星级：stars = [三星最多多走几步, 两星最多多走几步]，缝好就一星。正好最少步数另给「金针」。
	 * 难关推理时免不了试错，给的余量更大。
	 */
	function starsFor(steps, min, [three, two] = [2, 6]) {
		if (steps <= min + three) return 3;
		if (steps <= min + two) return 2;
		return 1;
	}

	const api = {
		BORDER, MAX_COLORS, LEVELS, BONUS, makeRng, hashString, solvedTiles, allDistinct, countSolutions, guessCount, fullySewn, knownAtStart, balanced, minSwaps,
		makePuzzle, matchedSeams, seamTotal, isSolved, isPermutation, applySwap, hintSwap, starsFor,
	};
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.Quilt = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
