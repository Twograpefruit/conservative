import { EditorView } from '@codemirror/view';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

/** GitHub Primer light editor surface. */
const lightEditor = EditorView.theme(
  {
    '&': { color: '#1f2328', backgroundColor: '#ffffff' },
    '.cm-content': { caretColor: '#0969da' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#0969da' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#b6d7ff',
    },
    '.cm-gutters': {
      backgroundColor: '#f6f8fa',
      color: '#6e7781',
      border: 'none',
      borderRight: '1px solid #d0d7de',
    },
    '.cm-activeLine': { backgroundColor: '#f6f8fa' },
    '.cm-activeLineGutter': { backgroundColor: '#eaeef2', color: '#1f2328' },
    '.cm-lineNumbers .cm-gutterElement': { color: '#8c959f' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(84, 174, 255, 0.4)',
      outline: '1px solid rgba(9, 105, 218, 0.2)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(9, 105, 218, 0.1)' },
    '.cm-tooltip': { backgroundColor: '#ffffff', border: '1px solid #d0d7de', color: '#1f2328' },
    '.cm-panels': { backgroundColor: '#f6f8fa', color: '#1f2328' },
    '.cm-searchMatch': { backgroundColor: '#fff8c5', outline: '1px solid #d4a72c' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(255, 211, 61, 0.4)' },
  },
  { dark: false },
);

const lightHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#6e7781', fontStyle: 'italic' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: '#cf222e' },
  { tag: [t.string, t.special(t.string)], color: '#0a3069' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#0550ae' },
  { tag: [t.variableName, t.propertyName], color: '#953800' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#8250df' },
  { tag: [t.typeName, t.className, t.namespace], color: '#8250df' },
  { tag: [t.tagName], color: '#116329' },
  { tag: [t.attributeName, t.attributeValue], color: '#0550ae' },
  { tag: [t.meta, t.documentMeta, t.processingInstruction], color: '#6e7781' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#1f2328' },
  { tag: t.invalid, color: '#cf222e' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#0969da', textDecoration: 'underline' },
]);

/** GitHub Primer dark editor surface. */
const darkEditor = EditorView.theme(
  {
    '&': { color: '#e6edf3', backgroundColor: '#0d1117' },
    '.cm-content': { caretColor: '#58a6ff' },
    '.cm-cursor, .cm-dropCursor': { borderLeftColor: '#58a6ff' },
    '&.cm-focused .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection': {
      backgroundColor: '#264f78',
    },
    '.cm-gutters': {
      backgroundColor: '#0d1117',
      color: '#6e7681',
      border: 'none',
      borderRight: '1px solid #30363d',
    },
    '.cm-activeLine': { backgroundColor: '#161b22' },
    '.cm-activeLineGutter': { backgroundColor: '#161b22', color: '#e6edf3' },
    '.cm-lineNumbers .cm-gutterElement': { color: '#6e7681' },
    '.cm-matchingBracket, &.cm-focused .cm-matchingBracket': {
      backgroundColor: 'rgba(56, 139, 253, 0.3)',
      outline: '1px solid rgba(88, 166, 255, 0.4)',
    },
    '.cm-selectionMatch': { backgroundColor: 'rgba(88, 166, 255, 0.12)' },
    '.cm-tooltip': { backgroundColor: '#161b22', border: '1px solid #30363d', color: '#e6edf3' },
    '.cm-panels': { backgroundColor: '#161b22', color: '#e6edf3' },
    '.cm-searchMatch': { backgroundColor: 'rgba(187, 128, 9, 0.35)', outline: '1px solid #9e6a03' },
    '.cm-searchMatch.cm-searchMatch-selected': { backgroundColor: 'rgba(187, 128, 9, 0.55)' },
  },
  { dark: true },
);

const darkHighlight = HighlightStyle.define([
  { tag: t.comment, color: '#8b949e', fontStyle: 'italic' },
  { tag: [t.keyword, t.operatorKeyword, t.modifier, t.controlKeyword], color: '#ff7b72' },
  { tag: [t.string, t.special(t.string)], color: '#a5d6ff' },
  { tag: [t.number, t.bool, t.null, t.atom], color: '#79c0ff' },
  { tag: [t.variableName, t.propertyName], color: '#ffa657' },
  { tag: [t.function(t.variableName), t.function(t.propertyName), t.labelName], color: '#d2a8ff' },
  { tag: [t.typeName, t.className, t.namespace], color: '#ffa657' },
  { tag: [t.tagName], color: '#7ee787' },
  { tag: [t.attributeName, t.attributeValue], color: '#79c0ff' },
  { tag: [t.meta, t.documentMeta, t.processingInstruction], color: '#8b949e' },
  { tag: [t.operator, t.punctuation, t.bracket], color: '#e6edf3' },
  { tag: t.invalid, color: '#ffa198' },
  { tag: [t.heading, t.strong], fontWeight: '600' },
  { tag: t.emphasis, fontStyle: 'italic' },
  { tag: t.link, color: '#58a6ff', textDecoration: 'underline' },
]);

export const githubLight = [lightEditor, syntaxHighlighting(lightHighlight)];
export const githubDark = [darkEditor, syntaxHighlighting(darkHighlight)];
