// The word lists are stored front-coded to keep them small: each line starts with one character saying how many
// letters it shares with the line before ('0' for none, '1' for one, and so on), followed by the rest of it.
// "ghost, ghostly, ghosts" is stored as "0ghost / 5ly / 6s".

export function encode(lines) {
  let prev = '';
  return lines.map(line => {
    let n = 0;
    while (n < prev.length && n < line.length && prev[n] === line[n]) n++;
    prev = line;
    return String.fromCharCode(48 + n) + line.slice(n);
  }).join('\n');
}

export function decode(text) {
  const out = [];
  let prev = '';
  for (const row of text.split('\n')) {
    if (!row) continue;
    prev = prev.slice(0, row.charCodeAt(0) - 48) + row.slice(1);
    out.push(prev);
  }
  return out;
}
