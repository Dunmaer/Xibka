export function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 4000);
}

const TO_LATIN: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'zh', з: 'z', и: 'i', й: 'y', к: 'k', л: 'l',
  м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh',
  щ: 'shch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
  ա: 'a', բ: 'b', գ: 'g', դ: 'd', ե: 'e', զ: 'z', է: 'e', ը: 'y', թ: 't', ժ: 'zh', ի: 'i', լ: 'l', խ: 'kh',
  ծ: 'ts', կ: 'k', հ: 'h', ձ: 'dz', ղ: 'gh', ճ: 'ch', մ: 'm', յ: 'y', ն: 'n', շ: 'sh', ո: 'o', չ: 'ch', պ: 'p',
  ջ: 'j', ռ: 'r', ս: 's', վ: 'v', տ: 't', ր: 'r', ց: 'ts', ւ: 'v', փ: 'p', ք: 'k', օ: 'o', ֆ: 'f', և: 'ev',
};

/** ASCII-only file name part (browsers drop non-ASCII download names inconsistently). */
export function safeFileName(s: string) {
  const latin = Array.from(s.normalize('NFC').toLowerCase())
    .map((c) => TO_LATIN[c] ?? c)
    .join('')
    .normalize('NFKD');
  return (
    latin
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40) || 'curse'
  );
}
