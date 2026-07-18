(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.EteSpeech = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function () {
  'use strict';

  const IPA_READER = 'https://ipa-reader.com/';
  const IPA_READER_VOICE = 'Ewa';
  const VOWELS = Object.freeze({
    a: vowel('a', 33),
    á: vowel('a', 55),
    à: vowel('a', 11),
    ā: vowel('a', 33, true),
    e: vowel('e', 33),
    é: vowel('e', 55),
    è: vowel('e', 11),
    ē: vowel('e', 33, true),
    i: vowel('i', 33),
    í: vowel('i', 55),
    ì: vowel('i', 11),
    ī: vowel('i', 33, true),
    o: vowel('o', 33),
    ó: vowel('o', 55),
    ò: vowel('o', 11),
    ō: vowel('o', 33, true),
    ơ: vowel('ə', 33),
    ớ: vowel('ə', 55),
    ờ: vowel('ə', 11),
    u: vowel('u', 33),
    ú: vowel('u', 55),
    ù: vowel('u', 11),
    ū: vowel('u', 33, true),
    ẽ: vowel('æ', 33),
    õ: vowel('ɔ', 33),
    ĩ: vowel('ɪ', 33),
    ị: vowel('y', 33),
    ẹ: vowel('ø', 33),
    ư: vowel('ɯ', 33),
    ũ: vowel('ʊ', 33),
    ȡ: vowel('œ', 33),
    ẻ: vowel('æ', 55),
    ț: vowel('ø', 55),
    ȟ: vowel('œ', 55),
    ỉ: vowel('ɪ', 55),
    ȍ: vowel('y', 55),
    ỏ: vowel('ɔ', 55),
    ủ: vowel('ʊ', 55),
    ứ: vowel('ɯ', 55),
  });
  const CONSONANTS = Object.freeze({
    ğ: 'ɣ',
    h: 'x',
    g: 'g',
    c: 'k',
    l: 'l',
    r: 'ɾ',
    v: 'v',
    f: 'f',
    d: 'd',
    t: 't',
    b: 'b',
    p: 'p',
    s: 's',
    z: 't͡s',
    ş: 'ʃ',
    ç: 't͡ʃ',
    n: 'n',
    m: 'm',
    y: 'j',
    w: 'w',
    "'": 'ʔ',
    '’': 'ʔ',
  });
  const ASCII_CONSONANTS = Object.freeze({
    gh: 'ɣ',
    sh: 'ʃ',
    ch: 't͡ʃ',
  });
  const TONES = Object.freeze({ 11: '˩', 33: '˧', 55: '˥' });

  function vowel(ipa, tone, long = false) {
    return Object.freeze({ ipa, tone, long });
  }

  function transcription(text) {
    const source = String(text).normalize('NFC').toLowerCase();
    let ipa = '';
    for (let index = 0; index < source.length; index++) {
      const pair = source.slice(index, index + 2);
      if (ASCII_CONSONANTS[pair]) {
        ipa += ASCII_CONSONANTS[pair];
        index++;
        continue;
      }

      const char = source[index];
      const currentVowel = VOWELS[char];
      if (currentVowel) {
        ipa += currentVowel.ipa;
        if (currentVowel.long) ipa += 'ː';
        ipa += TONES[currentVowel.tone];
      } else if (CONSONANTS[char]) {
        ipa += CONSONANTS[char];
      } else if (/[.!?]/u.test(char)) {
        ipa = ipa.trimEnd() + char + ' ';
      } else if (/[,;:\n]/u.test(char)) {
        ipa = ipa.trimEnd() + ', ';
      } else if (/\s/u.test(char)) {
        ipa += ' ';
      }
      // Parenthetical structure marks, digits, '-', and '|' are silent.
    }
    return ipa.replace(/\s+/g, ' ').trim();
  }

  function readerUrl(text) {
    const ipa = transcription(text);
    if (!ipa) throw new Error('There is no pronounceable text');
    const url = new URL(IPA_READER);
    url.searchParams.set('text', ipa);
    url.searchParams.set('voice', IPA_READER_VOICE);
    return url.href;
  }

  function openReader(text) {
    const url = readerUrl(text);
    const opened = globalThis.open?.(url, '_blank');
    if (!opened) throw new Error('Allow pop-ups to open IPA Reader');
    try {
      opened.opener = null;
    } catch {
      // Cross-origin isolation may already have removed the opener.
    }
    return url;
  }

  return Object.freeze({
    vowels: VOWELS,
    consonants: CONSONANTS,
    transcription,
    readerUrl,
    openReader,
  });
});
