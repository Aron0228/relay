import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import '../../session_service.dart';
import 'workspace_avatar.dart';
import 'workspace_api.dart';
import 'workspace_frame.dart';
import '../../theme.dart';

class WorkspaceSelection extends StatefulWidget {
  const WorkspaceSelection({
    super.key,
    required this.sessions,
    required this.workspaces,
    required this.onSelect,
    required this.onCreate,
    required this.onRefresh,
    required this.onSignOut,
    required this.name,
    this.api,
  });
  final WorkspaceApi? api;
  final SessionService sessions;
  final List<Map<String, dynamic>> workspaces;
  final void Function(String) onSelect;
  final VoidCallback onCreate;
  final Future<void> Function() onRefresh;
  final VoidCallback onSignOut;
  final String name;

  @override
  State<WorkspaceSelection> createState() => _WorkspaceSelectionState();
}

class _WorkspaceSelectionState extends State<WorkspaceSelection> {
  late final _api = widget.api ?? WorkspaceApi(widget.sessions);
  List<Map<String, dynamic>> _invitations = [];
  String? _error;
  bool _busy = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _api.close();
    super.dispose();
  }

  Future<void> _load() async {
    try {
      final invitations = await _api.list('/workspace-invitations');
      if (mounted) {
        setState(() {
          _invitations = invitations;
          _error = null;
        });
      }
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not load invitations.');
    }
  }

  Future<void> _respond(String id, bool accept) async {
    setState(() => _busy = true);

    try {
      await _api.request('POST', '/workspace-invitations/$id/response', {
        'accept': accept,
      });
      await widget.onRefresh();
      if (mounted) await _load();
    } catch (_) {
      if (mounted) setState(() => _error = 'Could not update this invitation.');
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) => WorkspaceFrame(
    onBack: widget.sessions.workspaceId == null
        ? null
        : () => widget.onSelect(widget.sessions.workspaceId!),
    onSignOut: widget.onSignOut,
    onRefresh: () async {
      await widget.onRefresh();
      await _load();
    },
    child: Column(
      crossAxisAlignment: CrossAxisAlignment.stretch,
      children: [
        const Padding(
          padding: EdgeInsets.symmetric(horizontal: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                'Workspaces',
                style: TextStyle(
                  fontSize: 26,
                  fontWeight: FontWeight.w500,
                  letterSpacing: -.5,
                ),
              ),
              SizedBox(height: 10),
              Text(
                'Choose where you want to work.',
                style: TextStyle(color: RelayTokens.muted),
              ),
            ],
          ),
        ),
        const SizedBox(height: 36),
        Container(
          clipBehavior: Clip.antiAlias,
          decoration: BoxDecoration(
            color: RelayTokens.surface,
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: Column(
            children: [
              for (final workspace in widget.workspaces) ...[
                InkWell(
                  onTap: () => widget.onSelect(workspace['id'] as String),
                  child: Padding(
                    padding: const EdgeInsets.all(18),
                    child: Row(
                      children: [
                        WorkspaceAvatar(
                          name: workspace['name'] as String,
                          url: workspace['avatarUrl'] as String?,
                          sessions: widget.sessions,
                          size: 40,
                        ),
                        const SizedBox(width: 14),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                workspace['name'] as String,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w500,
                                ),
                              ),
                              const SizedBox(height: 6),
                              Text(
                                '${workspace['memberCount'] ?? 1} members · ${workspace['isOwner'] == true ? 'Owner' : workspace['role']}',
                                style: const TextStyle(
                                  fontSize: 12,
                                  color: RelayTokens.muted,
                                ),
                              ),
                            ],
                          ),
                        ),
                        if (workspace['id'] == widget.sessions.workspaceId)
                          const Padding(
                            padding: EdgeInsets.only(right: 8),
                            child: Icon(
                              LucideIcons.check,
                              size: 16,
                              color: RelayTokens.primary,
                            ),
                          ),
                        const Icon(
                          LucideIcons.chevronRight,
                          size: 16,
                          color: RelayTokens.muted,
                        ),
                      ],
                    ),
                  ),
                ),
                if (workspace != widget.workspaces.last)
                  const Divider(height: 1),
              ],
              if (widget.workspaces.isEmpty)
                const Padding(
                  padding: EdgeInsets.all(20),
                  child: Text('You haven’t joined a workspace yet.'),
                ),
            ],
          ),
        ),
        const SizedBox(height: 16),
        Container(
          decoration: BoxDecoration(
            border: Border.all(color: RelayTokens.border),
            borderRadius: BorderRadius.circular(12),
          ),
          child: InkWell(
            onTap: widget.onCreate,
            child: const Padding(
              padding: EdgeInsets.all(18),
              child: Row(
                children: [
                  SizedBox(width: 40, child: Icon(LucideIcons.plus, size: 20)),
                  SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      'Create workspace',
                      style: TextStyle(color: RelayTokens.muted),
                    ),
                  ),
                  Icon(
                    LucideIcons.chevronRight,
                    size: 16,
                    color: RelayTokens.muted,
                  ),
                ],
              ),
            ),
          ),
        ),
        if (_error != null) TextButton(onPressed: _load, child: Text(_error!)),
        if (_invitations.isNotEmpty) ...[
          const SizedBox(height: 40),
          const Text(
            'Invitations',
            style: TextStyle(fontSize: 17, fontWeight: FontWeight.w500),
          ),
          for (final invitation in _invitations)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 16),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(invitation['workspaceName'] as String),
                  const SizedBox(height: 6),
                  Text(
                    invitation['email'] as String,
                    style: const TextStyle(
                      fontSize: 12,
                      color: RelayTokens.muted,
                    ),
                  ),
                  const SizedBox(height: 12),
                  Wrap(
                    spacing: 12,
                    children: [
                      TextButton(
                        onPressed: _busy
                            ? null
                            : () => _respond(invitation['id'] as String, false),
                        child: const Text('Decline'),
                      ),
                      FilledButton(
                        onPressed: _busy
                            ? null
                            : () => _respond(invitation['id'] as String, true),
                        child: const Text('Join workspace'),
                      ),
                    ],
                  ),
                ],
              ),
            ),
        ],
      ],
    ),
  );
}
