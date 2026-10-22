const segmenter = new Intl.Segmenter(undefined, { granularity: "word" });

export function tokenizeText(text: string) {
    return [...segmenter.segment(text)].filter((item) => item.isWordLike).map((item) => item.segment.toLocaleLowerCase());
}
