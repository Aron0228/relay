export const TODO_SITE = `<!doctype html>
<html><head><title>Candy Kingdom Todo</title></head>
<body>
  <h1>Finn and Jake's adventures</h1>
  <input class="new-todo" placeholder="Next adventure" autofocus>
  <ul class="todo-list"></ul>
  <nav><a href="#/completed">Completed</a> <a href="#/active">Active</a></nav>
  <script>
    const tasks = [];
    const list = document.querySelector('.todo-list');
    const input = document.querySelector('.new-todo');

    function render() {
      list.replaceChildren();

      for (const task of tasks) {
        if (location.hash === '#/completed' && !task.done) continue;
        if (location.hash === '#/active' && task.done) continue;

        const item = document.createElement('li');
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.className = 'toggle';
        toggle.checked = task.done;
        toggle.onchange = () => { task.done = toggle.checked; render(); };
        item.append(toggle, document.createTextNode(task.text));
        list.append(item);
      }
    }

    input.onkeydown = event => {
      if (event.key === 'Enter' && input.value) {
        tasks.push({text: input.value, done: false});
        input.value = '';
        render();
      }
    };
    window.onhashchange = render;
  </script>
</body></html>`;
