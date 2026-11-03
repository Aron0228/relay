import { Component, computed, input, ViewEncapsulation } from '@angular/core';
import { Marked, Renderer } from 'marked';

const escapeHtml = (value: string) =>
  value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

@Component({
  selector: 'app-markdown-content',
  encapsulation: ViewEncapsulation.None,
  template: '<div class="markdown-content" [innerHTML]="html()"></div>',
  styles: `
    app-markdown-content {
      display: block;
      min-width: 0;
    }
    app-markdown-content .markdown-content {
      font-size: 14px;
      line-height: 1.75;
      overflow-wrap: anywhere;
    }
    app-markdown-content :is(p, ul, ol, pre, blockquote, table) {
      margin: 0 0 16px;
    }
    app-markdown-content .markdown-content > :last-child {
      margin-bottom: 0;
    }
    app-markdown-content :is(h1, h2, h3, h4) {
      margin: 24px 0 12px;
      font-weight: 600;
      line-height: 1.4;
    }
    app-markdown-content h1 {
      font-size: 23px;
    }
    app-markdown-content h2 {
      font-size: 20px;
    }
    app-markdown-content h3 {
      font-size: 17px;
    }
    app-markdown-content li {
      margin-bottom: 6px;
    }
    app-markdown-content pre {
      padding: 14px;
      overflow-x: auto;
      border-radius: 8px;
      background: var(--color-surface);
    }
    app-markdown-content code {
      padding: 2px 5px;
      border-radius: 4px;
      background: var(--color-surface);
      font-size: 0.9em;
    }
    app-markdown-content pre code {
      padding: 0;
    }
    app-markdown-content blockquote {
      border-left: 3px solid var(--color-border);
      padding-left: 16px;
      color: var(--color-muted);
    }
    app-markdown-content img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
    }
    app-markdown-content table {
      display: block;
      max-width: 100%;
      overflow-x: auto;
      border-collapse: collapse;
    }
    app-markdown-content :is(th, td) {
      border: 1px solid var(--color-border);
      padding: 8px 12px;
    }
  `,
})
export class MarkdownContent {
  readonly content = input.required<string>();
  readonly baseUrl = input.required<string>();
  protected readonly html = computed(() => {
    const base = this.baseUrl();
    const url = (href: string, image = false) => {
      try {
        const resolved = new URL(href, base);
        return (image ? ['https:', 'http:'] : ['https:', 'http:', 'mailto:']).includes(
          resolved.protocol,
        )
          ? escapeHtml(resolved.href)
          : null;
      } catch {
        return null;
      }
    };
    const renderer = new Renderer();
    renderer.html = ({ text }) => escapeHtml(text);
    renderer.link = function ({ href, tokens }) {
      const target = url(href);
      const text = this.parser.parseInline(tokens);
      return target
        ? `<a href="${target}" target="_blank" rel="noopener noreferrer">${text}</a>`
        : text;
    };
    renderer.image = ({ href, text }) => {
      const source = url(href, true);
      return source
        ? `<img src="${source}" alt="${escapeHtml(text)}" loading="lazy">`
        : escapeHtml(text);
    };

    return new Marked({ renderer, gfm: true }).parse(this.content(), { async: false });
  });
}
