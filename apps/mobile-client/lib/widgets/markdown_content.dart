import 'package:flutter/material.dart';
import 'package:flutter_markdown_plus/flutter_markdown_plus.dart';
import 'package:url_launcher/url_launcher.dart';
import '../theme.dart';

class MarkdownContent extends StatelessWidget {
  const MarkdownContent({
    super.key,
    required this.content,
    required this.baseUrl,
  });
  final String content;
  final String baseUrl;

  @override
  Widget build(BuildContext context) {
    final base = Uri.parse(baseUrl);

    return MarkdownBody(
      data: content,
      selectable: true,
      styleSheet: MarkdownStyleSheet.fromTheme(Theme.of(context)).copyWith(
        p: const TextStyle(fontSize: 14, height: 1.75, color: RelayTokens.text),
        h1: const TextStyle(fontSize: 23, fontWeight: FontWeight.w600),
        h2: const TextStyle(fontSize: 20, fontWeight: FontWeight.w600),
        h3: const TextStyle(fontSize: 17, fontWeight: FontWeight.w600),
        blockSpacing: 16,
        codeblockDecoration: BoxDecoration(
          color: RelayTokens.content,
          borderRadius: BorderRadius.circular(8),
        ),
      ),
      onTapLink: (_, href, _) async {
        if (href == null) return;
        try {
          final uri = base.resolve(href);
          if (['https', 'http', 'mailto'].contains(uri.scheme)) {
            await launchUrl(uri, mode: LaunchMode.externalApplication);
          }
        } catch (_) {
          if (context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              const SnackBar(content: Text('Could not open this link.')),
            );
          }
        }
      },
      imageBuilder: (uri, title, alt) {
        final resolved = base.resolveUri(uri);
        if (!['https', 'http'].contains(resolved.scheme)) {
          return Text(alt ?? '');
        }
        return Image.network(
          resolved.toString(),
          fit: BoxFit.contain,
          errorBuilder: (_, error, stack) => Text(alt ?? 'Image unavailable'),
        );
      },
    );
  }
}
