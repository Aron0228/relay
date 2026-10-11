import {PlaywrightInterface} from '../playwright.interface';

export async function exampleTodo(
  browser: PlaywrightInterface,
  url: string,
): Promise<void> {
  await browser.navigate(url);
  await browser.fill('.new-todo', 'Test1');
  await browser.press('.new-todo', 'Enter');
  await browser.fill('.new-todo', 'Test2');
  await browser.press('.new-todo', 'Enter');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('.todo-list li:first-child .toggle');
  await browser.click('a[href="#/completed"]');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('a[href="#/active"]');
  await browser.assertText('.todo-list', 'Test2');

  await browser.fill('.new-todo', 'Test1');
  await browser.press('.new-todo', 'Enter');
  await browser.fill('.new-todo', 'Test2');
  await browser.press('.new-todo', 'Enter');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('.todo-list li:first-child .toggle');
  await browser.click('a[href="#/completed"]');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('a[href="#/active"]');
  await browser.assertText('.todo-list', 'Test2');

  await browser.fill('.new-todo', 'Test1');
  await browser.press('.new-todo', 'Enter');
  await browser.fill('.new-todo', 'Test2');
  await browser.press('.new-todo', 'Enter');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('.todo-list li:first-child .toggle');
  await browser.click('a[href="#/completed"]');
  await browser.assertText('.todo-list', 'Test1');
  await browser.click('a[href="#/active"]');
  await browser.assertText('.todo-list', 'Test2');
}
