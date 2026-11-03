import 'dart:async';
import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import '../../theme.dart';
import '../workspace/workspace_api.dart';
import 'issue_detail.dart';
import 'issue_status.dart';

class IssuesPage extends StatefulWidget {
  const IssuesPage({super.key, required this.sessions});
  final SessionService sessions;

  @override
  State<IssuesPage> createState() => _IssuesPageState();
}

class _IssuesPageState extends State<IssuesPage> {
  late final _api = WorkspaceApi(widget.sessions);
  final _search = TextEditingController();
  List<Map<String, dynamic>> _items = [];
  String? _cursor;
  String? _error;
  bool _loading = true;
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
    if (mounted) setState(() => _loading = true);

    try {
      final query = Uri(
        queryParameters: {
          'workspaceId': widget.sessions.workspaceId!,
          if (_search.text.trim().isNotEmpty) 'search': _search.text.trim(),
          'before': ?(more ? _cursor : null),
        },
      ).query;
      final page =
          await _api.request('GET', '/issues?$query') as Map<String, dynamic>;
      if (!mounted || revision != _revision) return;

      final items = (page['items'] as List).cast<Map<String, dynamic>>();
      setState(() {
        _items = more
            ? [
                ..._items,
                ...items.where(
                  (item) =>
                      !_items.any((existing) => existing['id'] == item['id']),
                ),
              ]
            : items;
        _cursor = page['nextCursor'] as String?;
        _error = null;
      });
    } catch (_) {
      if (mounted && revision == _revision) {
        setState(() => _error = 'Could not load issues. Please try again.');
      }
    } finally {
      if (mounted && revision == _revision) {
        setState(() => _loading = false);
        if (!more) _timer = Timer(const Duration(seconds: 5), _load);
      }
    }
  }

  Future<void> _open(String id) async {
    _timer?.cancel();
    await Navigator.of(context).push(
      MaterialPageRoute<void>(
        builder: (_) => IssueDetailPage(sessions: widget.sessions, id: id),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: _search,
                decoration: const InputDecoration(
                  hintText: 'Search issues…',
                  prefixIcon: Icon(LucideIcons.search, size: 18),
                ),
                onChanged: (_) {
                  _debounce?.cancel();
                  _debounce = Timer(const Duration(milliseconds: 250), _load);
                },
              ),
            ),
            IconButton(
              tooltip: 'Refresh',
              onPressed: _loading ? null : _load,
              icon: const Icon(LucideIcons.refreshCw, size: 18),
            ),
          ],
        ),
        const SizedBox(height: 16),
        if (_error != null)
          Text(_error!, style: const TextStyle(color: RelayTokens.error)),
        Container(
          decoration: BoxDecoration(
            color: RelayTokens.content,
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              for (final item in _items)
                ListTile(
                  contentPadding: const EdgeInsets.symmetric(
                    horizontal: 14,
                    vertical: 6,
                  ),
                  title: Text(
                    '#${item['number']}  ${item['title']}',
                    style: const TextStyle(fontSize: 14),
                  ),
                  subtitle: Text(
                    item['repository'] as String,
                    style: const TextStyle(
                      color: RelayTokens.muted,
                      fontSize: 12,
                    ),
                  ),
                  trailing: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      IssueStatusBadge(
                        status: item['status'] as String,
                        outcome: item['outcome'] as String?,
                      ),
                      const SizedBox(width: 6),
                      const Icon(LucideIcons.chevronRight, size: 16),
                    ],
                  ),
                  onTap: () => _open(item['id'] as String),
                ),
              if (_items.isEmpty)
                Padding(
                  padding: const EdgeInsets.all(28),
                  child: Text(
                    _loading
                        ? 'Loading issues…'
                        : 'No issue investigations found.',
                    style: const TextStyle(color: RelayTokens.muted),
                  ),
                ),
            ],
          ),
        ),
        if (_cursor != null)
          Padding(
            padding: const EdgeInsets.only(top: 16),
            child: OutlinedButton(
              onPressed: _loading ? null : () => _load(more: true),
              child: const Text('Load more'),
            ),
          ),
      ],
    );
  }
}
