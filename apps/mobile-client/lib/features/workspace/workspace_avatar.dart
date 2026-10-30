import 'package:flutter/material.dart';
import '../../session_service.dart';

class WorkspaceAvatar extends StatelessWidget {
  const WorkspaceAvatar({
    super.key,
    required this.name,
    this.url,
    this.sessions,
    this.size = 32,
  });
  final SessionService? sessions;
  final double size;
  final String name;
  final String? url;

  @override
  Widget build(BuildContext context) => ClipRRect(
    borderRadius: BorderRadius.circular(8),
    child: SizedBox(
      width: size,
      height: size,
      child: url == null || url!.isEmpty
          ? _fallback(context)
          : Image.network(
              url!.startsWith('/api/') && sessions != null
                  ? '${sessions!.apiBaseUrl}${url!.substring(4)}'
                  : url!,
              headers: sessions?.authorizationHeaders,
              fit: BoxFit.cover,
              errorBuilder: (_, error, stack) => _fallback(context),
            ),
    ),
  );

  Widget _fallback(BuildContext context) => Container(
    color: Theme.of(context).colorScheme.surfaceContainerHighest,
    alignment: Alignment.center,
    child: Text(name.isEmpty ? 'W' : name[0].toUpperCase()),
  );
}
