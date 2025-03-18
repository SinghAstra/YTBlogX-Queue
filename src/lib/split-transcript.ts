export function splitTranscript(transcript: string, chunkSize: number = 8000) {
  const sentences = transcript.split(/(?<=[.!?])\s+/);
  const chunks = [];
  let currentChunk = "";

  for (const sentence of sentences) {
    if (sentence.length > chunkSize) {
      // Split long sentences into smaller chunks
      for (let i = 0; i < sentence.length; i += chunkSize) {
        chunks.push(sentence.slice(i, i + chunkSize));
      }
      continue; // Skip to next sentence
    }

    if ((currentChunk + sentence).length > chunkSize) {
      chunks.push(currentChunk);
      currentChunk = sentence;
    } else {
      currentChunk += " " + sentence;
    }
  }

  if (currentChunk) {
    chunks.push(currentChunk);
  }

  console.log("In splitTranscript chunks.length is ", chunks.length);

  return chunks;
}
