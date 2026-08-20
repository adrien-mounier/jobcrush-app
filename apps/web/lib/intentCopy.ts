// #257: the intent confirmation sentence has two homes — the front door's "Got it." bridge and
// its persistent line on the discovery screen — and four e2e files assert the string verbatim,
// so both homes must build it from this one source.
//
// The join is the repo's sentence-list convention (#184/#123): Oxford-less, "A, B and C".
export function joinOxfordless(list: string[]): string {
  if (list.length <= 1) return list[0] ?? "";
  if (list.length === 2) return `${list[0]} and ${list[1]}`;
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

export function lookForSentence(targetRole: string, areaLabels: string[]): string {
  return `We’ll look for ${targetRole} in ${joinOxfordless(areaLabels)}.`;
}
