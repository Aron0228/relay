import 'dart:async';
import 'package:flutter/material.dart';
import 'package:http/http.dart' as http;
import '../../session_service.dart';
import '../../theme.dart';
import 'execution_api.dart';
import 'activity_timeline.dart';
import 'run_media.dart';
import 'run_status.dart';

class RunDetailPage extends StatefulWidget {
  const RunDetailPage({
    super.key,
    required this.sessions,
    required this.id,
    required this.liveView,
  });
  final SessionService sessions;
  final String id;
  final bool liveView;

  @override
  State<RunDetailPage> createState() => _RunDetailPageState();
}

class _RunDetailPageState extends State<RunDetailPage> {
  late final ExecutionApi _api = ExecutionApi(widget.sessions);
  final _stream = http.Client();
  final _activityScroll = ScrollController();
  bool _follow = true;
  final List<RunEvent> _events = [];
  TestRun? _run;
  Map<String, dynamic>? _result;
  String? _error;
  Timer? _timer;
  bool _connected = false;
  bool _cancelling = false;

  @override
  void initState() {
    super.initState();
    _activityScroll.addListener(() {
      _follow =
          _activityScroll.position.maxScrollExtent - _activityScroll.offset <
          80;
    });
    _load();
    _watch();
  }

  Future<void> _load() async {
    _timer?.cancel();

    try {
      final run = await _api.get(widget.id);
      final result = run.active ? null : await _api.result(widget.id);

      if (!mounted) return;

      setState(() {
        _run = run;
        _result = result;
        _error = null;
      });
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load this run.');
    } finally {
      if (mounted && (_run?.active ?? false)) {
        _timer = Timer(const Duration(seconds: 3), _load);
      }
    }
  }

  Future<void> _watch() async {
    while (mounted) {
      try {
        await for (final event in _api.activity(
          widget.id,
          _events.isEmpty ? 0 : _events.last.sequence,
          _stream,
        )) {
          if (!mounted) return;

          setState(() {
            _connected = true;

            if (!_events.any((existing) => existing.id == event.id)) {
              _events.add(event);
            }
          });

          WidgetsBinding.instance.addPostFrameCallback((_) {
            if (mounted && _follow && _activityScroll.hasClients) {
              _activityScroll.jumpTo(_activityScroll.position.maxScrollExtent);
            }
          });

          if ([
            'run.completed',
            'run.failed',
            'run.cancelled',
          ].contains(event.type)) {
            await _load();

            return;
          }
        }

        if (_run != null && !_run!.active) return;
      } catch (_) {
        if (!mounted) return;

        setState(() => _connected = false);
      }

      await Future<void>.delayed(const Duration(seconds: 2));
    }
  }

  @override
  void dispose() {
    _timer?.cancel();
    _activityScroll.dispose();
    _stream.close();
    _api.close();
    super.dispose();
  }

  Future<void> _cancel() async {
    setState(() => _cancelling = true);

    try {
      await _api.cancel(widget.id);
      await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not stop this run.');
    } finally {
      if (mounted) setState(() => _cancelling = false);
    }
  }

  Widget _metrics() {
    final latest = _events
        .where(
          (event) =>
              (event.type == 'agent.metrics' ||
                  event.type == 'agent.completed') &&
              event.payload['tokenUsage'] != null,
        )
        .lastOrNull
        ?.payload;
    final usage = latest?['tokenUsage'] as Map<String, dynamic>?;
    final failed =
        latest?['failedToolCalls'] ??
        _events.where((event) => event.type == 'agent.tool_failed').length;
    final reported = (usage?['reportedRequests'] as num? ?? 0) > 0;
    final partial = reported && (usage?['unreportedRequests'] as num? ?? 0) > 0;

    return Padding(
      padding: const EdgeInsets.only(top: 16),
      child: Wrap(
        spacing: 24,
        runSpacing: 8,
        children: [
          Text('Failed tool calls: $failed'),
          Text(
            'Tokens used: ${reported ? usage!['totalTokens'] : 'Unavailable'}${partial ? ' (partial)' : ''}',
          ),
          if (reported)
            Text(
              'Input: ${usage!['inputTokens']} · Output: ${usage['outputTokens']}',
            ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) => Scaffold(
    appBar: AppBar(
      title: Text(
        '${widget.liveView ? 'Session' : 'Run'} #${widget.id.substring(0, 8)}',
      ),
    ),
    body: _run == null
        ? Center(
            child: _error == null
                ? const CircularProgressIndicator()
                : TextButton(onPressed: _load, child: Text(_error!)),
          )
        : SingleChildScrollView(
            padding: const EdgeInsets.all(20),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  _run!.title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w600,
                  ),
                ),
                const SizedBox(height: 12),
                Row(
                  children: [
                    RunStatusBadge(status: _run!.status),
                    const Spacer(),
                    if (_run!.active)
                      OutlinedButton(
                        onPressed: _cancelling || _run!.stopping
                            ? null
                            : _cancel,
                        child: Text(_run!.stopping ? 'Stopping…' : 'Stop run'),
                      ),
                  ],
                ),
                _metrics(),
                if (_error != null)
                  Text(
                    _error!,
                    style: const TextStyle(color: RelayTokens.error),
                  ),
                if (widget.liveView && !_run!.active)
                  Padding(
                    padding: const EdgeInsets.symmetric(vertical: 12),
                    child: TextButton(
                      onPressed: () => Navigator.of(context).pushReplacement(
                        MaterialPageRoute<void>(
                          settings: RouteSettings(name: '/runs/${widget.id}'),
                          builder: (_) => RunDetailPage(
                            sessions: widget.sessions,
                            id: widget.id,
                            liveView: false,
                          ),
                        ),
                      ),
                      child: const Text('Session ended · View completed run'),
                    ),
                  ),
                const SizedBox(height: 16),
                LayoutBuilder(
                  builder: (context, constraints) {
                    final media = RunMedia(api: _api, run: _run!);
                    final activity = Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        border: Border.all(color: RelayTokens.border),
                        borderRadius: BorderRadius.circular(12),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              const Expanded(
                                child: Text(
                                  'Agent activity',
                                  style: TextStyle(fontWeight: FontWeight.w600),
                                ),
                              ),
                              Text(
                                _run!.active
                                    ? _connected
                                          ? 'Live'
                                          : 'Reconnecting…'
                                    : 'Saved activity',
                                style: const TextStyle(
                                  color: RelayTokens.muted,
                                  fontSize: 11,
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 16),
                          ConstrainedBox(
                            constraints: const BoxConstraints(maxHeight: 600),
                            child: SingleChildScrollView(
                              controller: _activityScroll,
                              child: ActivityTimeline(events: _events),
                            ),
                          ),
                        ],
                      ),
                    );

                    return constraints.maxWidth > 900
                        ? Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Expanded(child: media),
                              const SizedBox(width: 20),
                              Expanded(child: activity),
                            ],
                          )
                        : Column(
                            children: [
                              media,
                              const SizedBox(height: 20),
                              activity,
                            ],
                          );
                  },
                ),
                if (!widget.liveView && !_run!.active)
                  Container(
                    width: double.infinity,
                    margin: const EdgeInsets.only(top: 20),
                    padding: const EdgeInsets.all(20),
                    decoration: BoxDecoration(
                      color: RelayTokens.surface,
                      borderRadius: BorderRadius.circular(12),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(
                          'Verdict: ${_result?['result']?['verdict'] ?? 'Unavailable'}',
                          style: const TextStyle(
                            fontWeight: FontWeight.w600,
                            color: RelayTokens.primaryHover,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          (_result?['result']?['summary'] ??
                                  _run!.data['error'] ??
                                  'No AI verdict was produced for this run.')
                              .toString(),
                        ),
                      ],
                    ),
                  ),
              ],
            ),
          ),
  );
}
