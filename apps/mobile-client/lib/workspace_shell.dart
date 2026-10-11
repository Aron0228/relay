import 'package:flutter/material.dart';
import 'package:lucide_icons_flutter/lucide_icons.dart';
import 'theme.dart';

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
    required this.onSignOut,
    this.busy = false,
    this.error,
  });

  final Map<String, dynamic> profile;
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
  String _query = '';
  bool _collapsed = false;
  bool _searching = false;

  String get _name => (widget.profile['name'] ?? 'GitHub account').toString();
  String get _email =>
      (widget.profile['email'] ?? 'Signed in with GitHub').toString();

  @override
  void dispose() {
    _searchController.dispose();

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
