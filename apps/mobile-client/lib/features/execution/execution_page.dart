import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import '../../theme.dart';
import 'execution_api.dart';
import 'run_detail.dart';
import 'run_media.dart';
import 'run_status.dart';

class ExecutionPage extends StatefulWidget {
  const ExecutionPage({
    super.key,
    required this.sessions,
    required this.workers,
  });
  final SessionService sessions;
  final bool workers;

  @override
  State<ExecutionPage> createState() => _ExecutionPageState();
}

class _ExecutionPageState extends State<ExecutionPage> {
  late final ExecutionApi _api = ExecutionApi(widget.sessions);
  final _search = TextEditingController();
  List<TestRun> _runs = [];
  List<TestRun> _queue = [];
  String? _cursor;
  String? _queueCursor;
  int _queuePages = 1;
  String? _error;
  bool _loading = true;
  bool _moreLoading = false;
  Timer? _timer;
  Timer? _debounce;
  int _revision = 0;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _revision++;
    _timer?.cancel();
    _debounce?.cancel();
    _search.dispose();
    _api.close();
    super.dispose();
  }

  Future<void> _load({bool more = false}) async {
    final revision = ++_revision;
    _timer?.cancel();

    try {
      final page = await _api.list(
        scope: widget.workers ? 'active' : 'all',
        search: _search.text,
        before: more ? _cursor : null,
      );
      var queue = widget.workers ? await _api.list(scope: 'queued') : null;

      for (var page = 1; page < _queuePages && queue?.cursor != null; page++) {
        final next = await _api.list(scope: 'queued', before: queue!.cursor);
        queue = (items: [...queue.items, ...next.items], cursor: next.cursor);
      }

      if (!mounted || revision != _revision) return;

      setState(() {
        _runs = more ? [..._runs, ...page.items] : page.items;
        _queue = queue?.items ?? [];
        _queueCursor = queue?.cursor;
        _cursor = page.cursor;
        _error = null;
        _loading = false;
      });
    } catch (_) {
      if (mounted && revision == _revision) {
        setState(() {
          _error = 'Could not load sessions. Please try again.';
          _loading = false;
        });
      }
    } finally {
      if (mounted && widget.workers) {
        _timer = Timer(const Duration(seconds: 4), _load);
      }
    }
  }

  Future<void> _open(TestRun run) async {
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        settings: RouteSettings(
          name: '/${widget.workers ? 'workers' : 'runs'}/${run.id}',
        ),
        builder: (_) => RunDetailPage(
          sessions: widget.sessions,
          id: run.id,
          liveView: widget.workers,
        ),
      ),
    );

    if (mounted) await _load();
  }

  Future<void> _newRun() async {
    final goal = TextEditingController();
    final url = TextEditingController(text: 'https://academybugs.com/');
    final form = GlobalKey<FormState>();
    var busy = false;
    String? error;
    final run = await showDialog<TestRun>(
      context: context,
      builder: (dialogContext) => StatefulBuilder(
        builder: (context, update) => AlertDialog(
          title: const Text('New run'),
          content: SizedBox(
            width: 420,
            child: Form(
              key: form,
              child: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    TextFormField(
                      controller: goal,
                      maxLines: 3,
                      maxLength: 4000,
                      decoration: const InputDecoration(labelText: 'Test goal'),
                      validator: (value) =>
                          value == null || value.trim().isEmpty
                          ? 'Enter a test goal'
                          : null,
                    ),
                    TextFormField(
                      controller: url,
                      decoration: const InputDecoration(
                        labelText: 'Target URL',
                      ),
                      validator: (value) =>
                          Uri.tryParse(value ?? '')?.hasAuthority == true
                          ? null
                          : 'Enter a valid URL',
                    ),
                    if (error != null)
                      Text(
                        error!,
                        style: const TextStyle(color: RelayTokens.error),
                      ),
                  ],
                ),
              ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: busy ? null : () => Navigator.pop(context),
              child: const Text('Cancel'),
            ),
            TextButton(
              onPressed: busy
                  ? null
                  : () async {
                      if (!form.currentState!.validate()) return;

                      update(() => busy = true);

                      try {
                        final run = await _api.create(
                          goal.text.trim(),
                          url.text.trim(),
                        );

                        if (context.mounted) Navigator.pop(context, run);
                      } catch (_) {
                        if (context.mounted) {
                          update(() {
                            busy = false;
                            error =
                                'Could not start the test. Check the approved target URL.';
                          });
                        }
                      }
                    },
              child: Text(busy ? 'Queuing…' : 'Start test'),
            ),
          ],
        ),
      ),
    );
    goal.dispose();
    url.dispose();

    if (run != null && mounted) {
      await Navigator.of(context).push(
        MaterialPageRoute<void>(
          settings: RouteSettings(name: '/workers/${run.id}'),
          builder: (_) => RunDetailPage(
            sessions: widget.sessions,
            id: run.id,
            liveView: true,
          ),
        ),
      );

      if (mounted) await _load();
    }
  }

  Widget _row(TestRun run) => Card(
    margin: const EdgeInsets.only(bottom: 8),
    child: ListTile(
      onTap: () => _open(run),
      title: Text(
        run.title,
        maxLines: 2,
        overflow: TextOverflow.ellipsis,
        style: const TextStyle(fontSize: 13),
      ),
      subtitle: Text(
        '#${run.shortId} · ${DateTime.parse(run.data['createdAt'] as String).toLocal().toString().substring(0, 16)}',
        style: const TextStyle(fontSize: 11, color: RelayTokens.muted),
      ),
      trailing: RunStatusBadge(status: run.status),
    ),
  );

  @override
  Widget build(BuildContext context) => Column(
    crossAxisAlignment: CrossAxisAlignment.start,
    children: [
      Row(
        children: [
          Expanded(
            child: widget.workers
                ? Text(
                    '${_runs.length} active sessions',
                    style: const TextStyle(color: RelayTokens.muted),
                  )
                : TextField(
                    controller: _search,
                    decoration: const InputDecoration(
                      hintText: 'Search runs',
                      prefixIcon: Icon(LucideIcons.search),
                    ),
                    onChanged: (_) {
                      _revision++;
                      _debounce?.cancel();
                      _debounce = Timer(
                        const Duration(milliseconds: 250),
                        _load,
                      );
                    },
                  ),
          ),
          const SizedBox(width: 12),
          OutlinedButton(onPressed: _newRun, child: const Text('New run')),
        ],
      ),
      const SizedBox(height: 20),
      if (_error != null)
        Row(
          children: [
            Expanded(
              child: Text(
                _error!,
                style: const TextStyle(color: RelayTokens.error),
              ),
            ),
            TextButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      if (_loading) const Center(child: CircularProgressIndicator()),
      if (widget.workers) ...[
        if (!_loading && _runs.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Text(
              'No active sessions. Workers start when a test is queued.',
              style: TextStyle(color: RelayTokens.muted),
            ),
          ),
        LayoutBuilder(
          builder: (context, constraints) {
            final columns = constraints.maxWidth > 1000
                ? 3
                : constraints.maxWidth > 650
                ? 2
                : 1;
            final width = (constraints.maxWidth - (columns - 1) * 16) / columns;

            return Wrap(
              spacing: 16,
              runSpacing: 16,
              children: _runs
                  .map(
                    (run) => SizedBox(
                      width: width,
                      child: Card(
                        child: Padding(
                          padding: const EdgeInsets.all(14),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Row(
                                children: [
                                  Expanded(
                                    child: Text(
                                      'Worker ${run.data['workerPid'] ?? run.shortId}',
                                    ),
                                  ),
                                  RunStatusBadge(status: run.status),
                                ],
                              ),
                              Padding(
                                padding: const EdgeInsets.symmetric(
                                  vertical: 12,
                                ),
                                child: Text(
                                  run.title,
                                  maxLines: 2,
                                  overflow: TextOverflow.ellipsis,
                                ),
                              ),
                              RunMedia(api: _api, run: run),
                              TextButton(
                                onPressed: () => _open(run),
                                child: const Text('Observe session'),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  )
                  .toList(),
            );
          },
        ),
        const SizedBox(height: 28),
        const Text(
          'Queue',
          style: TextStyle(fontWeight: FontWeight.w600, fontSize: 18),
        ),
        const SizedBox(height: 12),
        if (!_loading && _queue.isEmpty)
          const Text(
            'The queue is empty.',
            style: TextStyle(color: RelayTokens.muted),
          ),
        ..._queue.map(_row),
        if (_queueCursor != null)
          TextButton(
            onPressed: () {
              _queuePages++;
              _load();
            },
            child: const Text('Load more queued tests'),
          ),
      ] else ...[
        if (!_loading && _runs.isEmpty)
          const Padding(
            padding: EdgeInsets.symmetric(vertical: 36),
            child: Text(
              'No runs found.',
              style: TextStyle(color: RelayTokens.muted),
            ),
          ),
        ..._runs.map(_row),
      ],
      if (_cursor != null)
        Center(
          child: TextButton(
            onPressed: _moreLoading
                ? null
                : () async {
                    setState(() => _moreLoading = true);
                    await _load(more: true);

                    if (mounted) setState(() => _moreLoading = false);
                  },
            child: const Text('Load more'),
          ),
        ),
    ],
  );
}
