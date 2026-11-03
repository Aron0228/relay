interface ActionArguments {
  selector?: string | {selector?: string; role?: string; name?: string};
  role?: string;
  name?: string;
  value?: string;
  key?: string;
  url?: string;
}

export function describeBrowserAction(
  action: string,
  args: ActionArguments,
): string | undefined {
  const locator = typeof args.selector === 'object' ? args.selector : args;
  const selector =
    typeof args.selector === 'string' ? args.selector : locator.selector;
  const target = locator.name
    ? `${locator.role ?? 'element'} ${JSON.stringify(locator.name)}`
    : selector
      ? `element matching ${JSON.stringify(selector)}`
      : 'target element';

  switch (action.replace(/^browser/, '').toLowerCase()) {
    case 'navigate':
      return `Open ${args.url}.`;
    case 'fill':
      return `Enter ${JSON.stringify(args.value)} into the ${target}.`;
    case 'click':
      return `Click the ${target}.`;
    case 'press':
      return `Press ${JSON.stringify(args.key)} on the ${target}.`;
    default:
      return undefined;
  }
}

export const isBareBrowserAction = (action: string) =>
  /^(?:browser)?(?:fill|click|press|navigate|text|snapshot)[.!]?$/i.test(
    action.trim(),
  );
