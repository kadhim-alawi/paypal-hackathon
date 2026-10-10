import 'package:flutter/material.dart';

import 'core/app_scope.dart';
import 'router.dart';
import 'theme.dart';

class TideoverApp extends StatefulWidget {
  const TideoverApp({super.key, required this.services});
  final AppServices services;

  @override
  State<TideoverApp> createState() => _TideoverAppState();
}

class _TideoverAppState extends State<TideoverApp> {
  late final router = buildRouter(widget.services);

  @override
  Widget build(BuildContext context) => MaterialApp.router(
        title: 'Tideover — emergency cash in minutes',
        debugShowCheckedModeBanner: false,
        theme: buildTheme(),
        routerConfig: router,
      );
}
