// A JSON document read from a file, whose failure names the file. `JSON.parse` alone answers
// "Unexpected token '}', ... is not valid JSON" and never says which file held the text; a
// missing file already names its path in the system's own error.
import { readFileSync } from "node:fs";

/** The JSON document in `path`; a refusal names the file and keeps the parser's error. */
export function readJsonFile(path) {
  const text = readFileSync(path, "utf8");
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${path} is not JSON: ${error.message}`, { cause: error });
  }
}
