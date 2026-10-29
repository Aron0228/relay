import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'features/workspace/workspace_api.dart';
import 'features/workspace/workspace_avatar.dart';
import 'features/workspace/workspace_settings.dart';
import 'features/workspace/workspace_selection.dart';
import 'features/workspace/workspace_create.dart';
import 'theme.dart';
import 'session_service.dart';
import 'features/execution/execution_page.dart';

const _navigation = [
  (
    group: 'Workspace',
    items: [
      (name: 'Overview', icon: LucideIcons.textAlignStart),
      (name: 'Assistant', icon: LucideIcons.sparkle),
      (name: 'Workspace Settings', icon: LucideIcons.settings),
    ],
  ),
  (
    group: 'Testing',
    items: [
      (name: 'Workers', icon: LucideIcons.bot),
      (name: 'Runs', icon: LucideIcons.play),
      (name: 'Issues', icon: LucideIcons.circleDot),
      (name: 'Pull Requests', icon: LucideIcons.gitPullRequest),
    ],
  ),
];

class WorkspaceShell extends StatefulWidget {
  const WorkspaceShell({
    super.key,
    required this.profile,
    this.sessions,
    required this.onSignOut,
    this.busy = false,
    this.error,
  });

  final Map<String, dynamic> profile;
  final SessionService? sessions;
  final VoidCallback onSignOut;
  final bool busy;
  final String? error;

  @override
  State<WorkspaceShell> createState() => _WorkspaceShellState();
}

class _WorkspaceShellState extends State<WorkspaceShell> {
  final _scaffoldKey = GlobalKey<ScaffoldState>();
  final _searchController = TextEditingController();
  String _selected = 'Overview';
  WorkspaceApi? _workspaceApi;
  List<Map<String, dynamic>> _workspaces = [];
  bool _workspaceReady = false;
  bool _workspaceMenuOpen = false;
  bool _showWorkspaceList = true;
  String? _workspaceError;
  Map<String, dynamic>? get _workspace => _workspaces
      .where((item) => item['id'] == widget.sessions?.workspaceId)
      .firstOrNull;

  @override
  void initState() {
    super.initState();

    if (widget.sessions != null) {
      _workspaceApi = WorkspaceApi(widget.sessions!);
      _initializeWorkspaces();
    }
  }

  Future<void> _initializeWorkspaces() async {
    await widget.sessions!.restoreWorkspaceSelection();
    await _loadWorkspaces();
  }

  Future<void> _chooseWorkspace(String id) async {
    await widget.sessions!.selectWorkspace(id);

    if (mounted) {
      setState(() {
        _showWorkspaceList = false;
        _selected = 'Overview';
      });
    }
  }

  Future<void> _createWorkspace() async {
    final id = await Navigator.of(context).push<String>(
      MaterialPageRoute(
        builder: (_) => WorkspaceCreate(sessions: widget.sessions!),
      ),
    );

    if (id == null || !mounted) return;

    await _loadWorkspaces();
    await _chooseWorkspace(id);
  }

  Future<void> _loadWorkspaces() async {
    try {
      final workspaces = await _workspaceApi!.list('/workspaces');

      final validSelection = workspaces.any(
        (item) => item['id'] == widget.sessions!.workspaceId,
      );

      if (!validSelection) await widget.sessions!.selectWorkspace(null);
      if (!mounted) return;

      setState(() {
        _workspaces = workspaces;
        if (!validSelection) _showWorkspaceList = true;
        _workspaceReady = true;
        _workspaceError = null;
      });
    } catch (_) {
      if (mounted) {
        setState(
          () =>
              _workspaceError = 'Could not load workspaces. Please try again.',
        );
      }
    }
  }

  String _query = '';
  bool _collapsed = false;
  bool _searching = false;

  String get _name => (widget.profile['name'] ?? 'GitHub account').toString();
  String get _email =>
      (widget.profile['email'] ?? 'Signed in with GitHub').toString();

  @override
  void dispose() {
    _searchController.dispose();
    _workspaceApi?.close();

    super.dispose();
  }

  void _select(String name, bool mobile) {
    setState(() => _selected = name);

    if (mobile) Navigator.of(context).pop();
  }

  void _search() {
    setState(() {
      _collapsed = false;
      _searching = !_searching;
      _query = '';
      _searchController.clear();
    });
  }

  Widget _sidebar(bool mobile) {
    final collapsed = _collapsed && !mobile;
    final items = _navigation.expand((group) => group.items);
    final hasResults = items.any(
      (item) => item.name.toLowerCase().contains(_query.toLowerCase()),
    );

    return SizedBox(
      width: collapsed
          ? RelayTokens.sidebarCollapsedWidth
          : RelayTokens.sidebarWidth,
      child: Padding(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 16),
        child: Column(
          children: [
            if (collapsed)
              Column(
                children: [
                  IconButton(
                    tooltip: 'Expand sidebar',
                    onPressed: () => setState(() => _collapsed = false),
                    icon: const Icon(LucideIcons.panelLeft),
                  ),
                  IconButton(
                    tooltip: 'Search navigation',
                    onPressed: _search,
                    icon: const Icon(LucideIcons.search),
                  ),
                ],
              )
            else
              Row(
                children: [
                  const Expanded(
                    child: Text(
                      'Relay',
                      style: TextStyle(
                        fontSize: 24,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                  IconButton(
                    tooltip: 'Search navigation',
                    onPressed: _search,
                    icon: const Icon(LucideIcons.search),
                  ),
                  IconButton(
                    tooltip: mobile ? 'Close menu' : 'Collapse sidebar',
                    onPressed: () {
                      if (mobile) {
                        Navigator.of(context).pop();
                      } else {
                        setState(() => _collapsed = true);
                      }
                    },
                    icon: Icon(mobile ? LucideIcons.x : LucideIcons.panelLeft),
                  ),
                ],
              ),
            if (widget.sessions != null) ...[
              const SizedBox(height: 12),
              PopupMenuButton<String>(
                tooltip: 'Switch workspace',
                onOpened: () => setState(() => _workspaceMenuOpen = true),
                onCanceled: () => setState(() => _workspaceMenuOpen = false),
                onSelected: (id) {
                  setState(() => _workspaceMenuOpen = false);
                  if (mobile) Navigator.pop(context);

                  if (id == '_all') {
                    setState(() => _showWorkspaceList = true);
                  } else if (id == '_create') {
                    _createWorkspace();
                  } else {
                    _chooseWorkspace(id);
                  }
                },
                itemBuilder: (_) => [
                  for (final workspace in _workspaces)
                    PopupMenuItem(
                      value: workspace['id'] as String,
                      child: Row(
                        children: [
                          WorkspaceAvatar(
                            name: workspace['name'] as String,
                            url: workspace['avatarUrl'] as String?,
                            sessions: widget.sessions,
                          ),
                          const SizedBox(width: 12),
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              mainAxisSize: MainAxisSize.min,
                              children: [
                                Text(workspace['name'] as String),
                                Text(
                                  '${workspace['memberCount'] ?? 1} members · ${workspace['isOwner'] == true ? 'Owner' : workspace['role']}',
                                  style: const TextStyle(fontSize: 11),
                                ),
                              ],
                            ),
                          ),
                          if (workspace['id'] == widget.sessions!.workspaceId)
                            const Icon(LucideIcons.check, size: 16),
                        ],
                      ),
                    ),
                  const PopupMenuDivider(),
                  const PopupMenuItem(
                    value: '_all',
                    child: Text('All workspaces'),
                  ),
                  const PopupMenuItem(
                    value: '_create',
                    child: Text('Create workspace'),
                  ),
                ],
                child: Padding(
                  padding: const EdgeInsets.symmetric(vertical: 12),
                  child: Row(
                    children: [
                      if (_workspace != null)
                        WorkspaceAvatar(
                          name: _workspace!['name'] as String,
                          url: _workspace!['avatarUrl'] as String?,
                          sessions: widget.sessions,
                        ),
                      if (!collapsed) ...[
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                _workspace?['name'] as String? ?? 'Workspaces',
                                maxLines: 1,
                                overflow: TextOverflow.ellipsis,
                                style: const TextStyle(
                                  fontWeight: FontWeight.w600,
                                ),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                _workspace?['isOwner'] == true
                                    ? 'Owner'
                                    : _workspace?['role'] as String? ?? '',
                                style: const TextStyle(fontSize: 11),
                              ),
                            ],
                          ),
                        ),
                        Icon(
                          _workspaceMenuOpen
                              ? LucideIcons.chevronUp
                              : LucideIcons.chevronDown,
                          size: 16,
                        ),
                      ],
                    ],
                  ),
                ),
              ),
            ],
            const SizedBox(height: RelayTokens.medium),
            if (_searching && !collapsed)
              Padding(
                padding: const EdgeInsets.only(bottom: 16),
                child: TextField(
                  controller: _searchController,
                  autofocus: true,
                  decoration: const InputDecoration(
                    labelText: 'Search navigation',
                    isDense: true,
                    border: OutlineInputBorder(),
                  ),
                  onChanged: (value) => setState(() => _query = value),
                ),
              ),
            Expanded(
              child: ListView(
                children: [
                  for (final group in _navigation) ...[
                    if (!collapsed)
                      Padding(
                        padding: const EdgeInsets.fromLTRB(8, 0, 8, 8),
                        child: Text(
                          group.group,
                          style: const TextStyle(
                            color: RelayTokens.muted,
                            fontSize: 12,
                            fontWeight: FontWeight.w600,
                          ),
                        ),
                      ),
                    for (final item in group.items)
                      if (item.name.toLowerCase().contains(
                        _query.toLowerCase(),
                      ))
                        Padding(
                          padding: const EdgeInsets.only(bottom: 4),
                          child: Semantics(
                            selected: _selected == item.name,
                            child: Tooltip(
                              message: item.name,
                              child: Material(
                                color: _selected == item.name
                                    ? RelayTokens.primaryHover
                                    : Colors.transparent,
                                borderRadius: BorderRadius.circular(8),
                                child: InkWell(
                                  borderRadius: BorderRadius.circular(8),
                                  onTap: () => _select(item.name, mobile),
                                  child: Padding(
                                    padding: const EdgeInsets.symmetric(
                                      horizontal: 10,
                                      vertical: 12,
                                    ),
                                    child: Row(
                                      mainAxisAlignment: collapsed
                                          ? MainAxisAlignment.center
                                          : MainAxisAlignment.start,
                                      children: [
                                        Icon(
                                          item.icon,
                                          color: _selected == item.name
                                              ? RelayTokens.onPrimary
                                              : RelayTokens.text,
                                          size: 22,
                                          semanticLabel: collapsed
                                              ? item.name
                                              : null,
                                        ),
                                        if (!collapsed) ...[
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Text(
                                              item.name,
                                              style: TextStyle(
                                                color: _selected == item.name
                                                    ? RelayTokens.onPrimary
                                                    : RelayTokens.text,
                                                fontSize: 14,
                                                fontWeight: FontWeight.w500,
                                              ),
                                            ),
                                          ),
                                        ],
                                      ],
                                    ),
                                  ),
                                ),
                              ),
                            ),
                          ),
                        ),
                    const SizedBox(height: 20),
                  ],
                  if (!hasResults)
                    const Text(
                      'No pages found.',
                      style: TextStyle(color: RelayTokens.muted),
                    ),
                ],
              ),
            ),
            PopupMenuButton<String>(
              tooltip: 'Account menu',
              enabled: !widget.busy,
              onSelected: (_) => widget.onSignOut(),
              itemBuilder: (_) => [
                const PopupMenuItem(value: 'sign-out', child: Text('Sign out')),
              ],
              child: Padding(
                padding: const EdgeInsets.symmetric(vertical: 8),
                child: Row(
                  mainAxisAlignment: collapsed
                      ? MainAxisAlignment.center
                      : MainAxisAlignment.start,
                  children: [
                    CircleAvatar(
                      radius: 18,
                      backgroundColor: RelayTokens.text,
                      foregroundColor: RelayTokens.buttonText,
                      child: Text(_name.isEmpty ? 'G' : _name[0].toUpperCase()),
                    ),
                    if (!collapsed) ...[
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              _name,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                fontWeight: FontWeight.w600,
                              ),
                            ),
                            const SizedBox(height: 5),
                            Text(
                              _email,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                              style: const TextStyle(
                                color: RelayTokens.muted,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ],
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _content(bool mobile) => Container(
    margin: EdgeInsets.fromLTRB(mobile ? 8 : 0, mobile ? 0 : 8, 8, 8),
    padding: EdgeInsets.all(mobile ? RelayTokens.medium : RelayTokens.large),
    decoration: BoxDecoration(
      color: RelayTokens.content,
      border: Border.all(color: RelayTokens.border),
      borderRadius: BorderRadius.circular(RelayTokens.radius),
    ),
    child: SizedBox.expand(
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              _selected,
              style: TextStyle(
                fontSize: mobile ? 26 : 32,
                fontWeight: FontWeight.w600,
                letterSpacing: -1,
              ),
            ),
            if (widget.sessions != null && _workspaceError != null)
              TextButton(
                onPressed: _loadWorkspaces,
                child: Text(_workspaceError!),
              ),
            if (widget.sessions != null &&
                !_workspaceReady &&
                _workspaceError == null)
              const CircularProgressIndicator(),
            if (widget.sessions != null &&
                _workspaceReady &&
                (_workspace == null || _selected == 'Workspace Settings'))
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: WorkspaceSettings(
                  key: ValueKey('${_workspace?['id']}-${_workspace?['role']}'),
                  sessions: widget.sessions!,
                  workspace: _workspace,
                  onChanged: _loadWorkspaces,
                ),
              ),
            if (widget.sessions != null &&
                _workspace != null &&
                (_selected == 'Workers' || _selected == 'Runs'))
              Padding(
                padding: const EdgeInsets.only(top: 24),
                child: ExecutionPage(
                  key: ValueKey('${widget.sessions!.workspaceId}-$_selected'),
                  sessions: widget.sessions!,
                  workers: _selected == 'Workers',
                ),
              ),
            if (widget.error != null)
              Padding(
                padding: const EdgeInsets.only(top: RelayTokens.medium),
                child: Semantics(
                  liveRegion: true,
                  child: Text(
                    widget.error!,
                    style: const TextStyle(color: RelayTokens.error),
                  ),
                ),
              ),
          ],
        ),
      ),
    ),
  );

  @override
  Widget build(BuildContext context) => LayoutBuilder(
    builder: (context, constraints) {
      final mobile = constraints.maxWidth <= RelayTokens.mobileBreakpoint;

      if (widget.sessions != null && !_workspaceReady) {
        return Scaffold(
          appBar: AppBar(title: const Text('Workspaces')),
          body: Center(
            child: _workspaceError == null
                ? const CircularProgressIndicator()
                : TextButton(
                    onPressed: _loadWorkspaces,
                    child: Text(_workspaceError!),
                  ),
          ),
        );
      }

      if (widget.sessions != null &&
          (_showWorkspaceList || _workspace == null)) {
        return WorkspaceSelection(
          sessions: widget.sessions!,
          workspaces: _workspaces,
          onSelect: _chooseWorkspace,
          onCreate: _createWorkspace,
          onRefresh: _loadWorkspaces,
          onSignOut: widget.onSignOut,
          name: _name,
        );
      }

      return Scaffold(
        key: _scaffoldKey,
        appBar: mobile
            ? AppBar(
                title: Text(_selected, style: const TextStyle(fontSize: 16)),
                centerTitle: true,
                backgroundColor: RelayTokens.background,
                leading: IconButton(
                  tooltip: 'Open menu',
                  icon: const Icon(LucideIcons.menu),
                  onPressed: () => _scaffoldKey.currentState?.openDrawer(),
                ),
              )
            : null,
        drawer: mobile
            ? Drawer(
                width: RelayTokens.sidebarWidth,
                backgroundColor: RelayTokens.background,
                child: SafeArea(child: _sidebar(true)),
              )
            : null,
        body: SafeArea(
          child: Row(
            children: [
              if (!mobile) _sidebar(false),
              Expanded(child: _content(mobile)),
            ],
          ),
        ),
      );
    },
  );
}
