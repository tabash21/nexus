declare module 'multilang-sentiment' {
  interface SentimentAnalysisResult {
    score: number;
    positiveScore: number;
    negativeScore: number;
    comparative: number;
    category: 'positive' | 'neutral' | 'negative';
    tokens: { value: string; negate: boolean }[];
    words: string[];
    positive: string[];
    negative: string[];
  }

  function analyzeSentiment(
    text: string,
    language?: string,
  ): SentimentAnalysisResult;

  export default analyzeSentiment;
}