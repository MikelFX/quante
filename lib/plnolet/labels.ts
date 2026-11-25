// Client-safe Plnolet names (no node:crypto): the verification methods and their Czech labels.
export type Method = 'test' | 'pass' | 'mojeid' | 'bankid'

export const METHOD_LABEL: Record<Method, string> = {
  test: 'Testovací ověření',
  pass: 'Věkový pas',
  mojeid: 'mojeID',
  bankid: 'Bank iD',
}
