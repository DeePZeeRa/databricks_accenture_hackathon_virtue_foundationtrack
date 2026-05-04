param(
	[string]$InputPath = ".",
	[string]$PythonExe = "$env:LocalAppData\Programs\Python\Python312\python.exe"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $PythonExe)) {
	throw "Python not found at '$PythonExe'. Install Python or pass -PythonExe <path>."
}

# Step 1
& $PythonExe -c "import graphify; import sys; from pathlib import Path; Path('graphify-out').mkdir(exist_ok=True); Path('graphify-out/.graphify_python').write_text(sys.executable)"

# Step 2
& $PythonExe -c "import json; from graphify.detect import detect; from pathlib import Path; result = detect(Path(r'$InputPath')); Path('graphify-out/.graphify_detect.json').write_text(json.dumps(result, indent=2)); total = result.get('total_files', 0); words = result.get('total_words', 0); print(f'Corpus: {total} files, ~{words} words'); [print(f'  {ftype}: {len(files)} files') for ftype, files in result.get('files', {}).items() if files]"

# Step 3A
& $PythonExe -c "import json; from graphify.extract import collect_files, extract; from pathlib import Path; detect=json.loads(Path('graphify-out/.graphify_detect.json').read_text()); code_files=[]; [code_files.extend(collect_files(p) if p.is_dir() else [p]) for p in [Path(f) for f in detect.get('files',{}).get('code',[])]]; result=extract(code_files) if code_files else {'nodes':[],'edges':[],'input_tokens':0,'output_tokens':0}; Path('graphify-out/.graphify_ast.json').write_text(json.dumps(result, indent=2)); print('AST: {} nodes, {} edges'.format(len(result['nodes']), len(result['edges'])) if code_files else 'No code files - skipping AST extraction')"

# Step 3B (cache only; uncached semantic extraction should be handled via subagents)
& $PythonExe -c "import json; from graphify.cache import check_semantic_cache; from pathlib import Path; detect=json.loads(Path('graphify-out/.graphify_detect.json').read_text()); all_files=[f for files in detect['files'].values() for f in files]; cached_nodes, cached_edges, cached_hyperedges, uncached = check_semantic_cache(all_files); (Path('graphify-out/.graphify_cached.json').write_text(json.dumps({'nodes': cached_nodes, 'edges': cached_edges, 'hyperedges': cached_hyperedges})) if (cached_nodes or cached_edges) else None); Path('graphify-out/.graphify_uncached.txt').write_text('\n'.join(uncached)); print('Cache: {} hit, {} need extraction'.format(len(all_files)-len(uncached), len(uncached)))"

# Step 3 merge (AST + cache only in this local runner)
& $PythonExe -c "import json; from pathlib import Path; all_nodes, all_edges, all_hyperedges = [], [], []; ast = json.loads(Path('graphify-out/.graphify_ast.json').read_text()); all_nodes.extend(ast.get('nodes', [])); all_edges.extend(ast.get('edges', [])); cached_path = Path('graphify-out/.graphify_cached.json'); cached = json.loads(cached_path.read_text()) if cached_path.exists() else {'nodes': [], 'edges': [], 'hyperedges': []}; all_nodes.extend(cached.get('nodes', [])); all_edges.extend(cached.get('edges', [])); all_hyperedges.extend(cached.get('hyperedges', [])); merged = {'nodes': all_nodes, 'edges': all_edges, 'hyperedges': all_hyperedges, 'input_tokens': 0, 'output_tokens': 0}; Path('graphify-out/.graphify_extract.json').write_text(json.dumps(merged, indent=2)); print('Merged: {} nodes, {} edges'.format(len(all_nodes), len(all_edges)))"

# Step 4
& $PythonExe -c "import json; from graphify.build import build_from_json; from graphify.cluster import cluster; from graphify.analyze import god_nodes, surprising_connections; from pathlib import Path; from networkx.readwrite import json_graph; extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text()); G = build_from_json(extraction); communities = cluster(G); gods = god_nodes(G); surprises = surprising_connections(G, communities); graph_data = json_graph.node_link_data(G); Path('graphify-out/graph.json').write_text(json.dumps(graph_data, indent=2)); Path('graphify-out/.graphify_analysis.json').write_text(json.dumps({'communities': {str(k): v for k, v in communities.items()}, 'cohesion': {}, 'god_nodes': gods, 'surprises': surprises}, indent=2)); print('Graph: {} nodes, {} edges, {} communities'.format(G.number_of_nodes(), G.number_of_edges(), len(communities))); print('God nodes: {}'.format([g['label'] for g in gods[:5]]))"

# Step 5 report
& $PythonExe -c "import json; from graphify.build import build_from_json; from graphify.analyze import god_nodes, surprising_connections; from graphify.report import generate; from pathlib import Path; extraction=json.loads(Path('graphify-out/.graphify_extract.json').read_text()); analysis=json.loads(Path('graphify-out/.graphify_analysis.json').read_text()); detect=json.loads(Path('graphify-out/.graphify_detect.json').read_text()); G=build_from_json(extraction); communities={int(k): v for k, v in analysis['communities'].items()}; gods=god_nodes(G); surprises=surprising_connections(G, communities); token_cost={'input_tokens': extraction.get('input_tokens', 0), 'output_tokens': extraction.get('output_tokens', 0)}; report=generate(G, communities, {}, {}, gods, surprises, detect, token_cost, '.'); Path('graphify-out/GRAPH_REPORT.md').write_text(report, encoding='utf-8'); print('GRAPH_REPORT.md written')"

# Step 5 visualization
& $PythonExe -c "import json; from graphify.build import build_from_json; from graphify.cluster import cluster; from graphify.export import to_html; from pathlib import Path; extraction = json.loads(Path('graphify-out/.graphify_extract.json').read_text()); G = build_from_json(extraction); communities = cluster(G); to_html(G, communities, 'graphify-out/graph.html'); print('graph.html written')"

Write-Host "graphify complete"
Write-Host "  graph.json      - GraphRAG-ready, queryable by MCP or CLI"
Write-Host "  graph.html      - interactive visualization (open in browser)"
Write-Host "  GRAPH_REPORT.md - plain-language architecture summary"
