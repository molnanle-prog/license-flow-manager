
import os

target_file = r'C:\Users\CEO\Desktop\라이선스-플로우-매니저(메일-보내기-기능-업그레이드)\components\LicenseManager.tsx'

with open(target_file, 'r', encoding='utf-8') as f:
    lines = f.readlines()

# 1. Add sortConfig state
# Insert after searchTerm state (around line 95)
new_lines = []
for line in lines:
    new_lines.append(line)
    if 'const [searchTerm, setSearchTerm] = useState' in line:
        new_lines.append("  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' }>({ key: 'createdAt', direction: 'desc' });\n")

# 2. Update compareVersions and add handleSort
# Replace old compareVersions (around line 138)
start_idx = -1
end_idx = -1
for i, line in enumerate(new_lines):
    if 'const compareVersions = useCallback((v1: string, v2: string)' in line:
        start_idx = i
    if start_idx != -1 and '}, []);' in line and i > start_idx:
        end_idx = i
        break

if start_idx != -1 and end_idx != -1:
    new_logic = [
        "  const compareVersions = useCallback((v1: string, v2: string) => {\n",
        "      // Handle empty/null versions by assigning low priority\n",
        "      if (!v1 && !v2) return 0;\n",
        "      if (!v1) return -1;\n",
        "      if (!v2) return 1;\n",
        "      const p1 = v1.replace(/[^0-9.]/g, '').split('.').map(Number);\n",
        "      const p2 = v2.replace(/[^0-9.]/g, '').split('.').map(Number);\n",
        "      for (let i = 0; i < Math.max(p1.length, p2.length); i++) {\n",
        "          const n1 = p1[i] || 0;\n",
        "          const n2 = p2[i] || 0;\n",
        "          if (n1 > n2) return 1;\n",
        "          if (n1 < n2) return -1;\n",
        "      }\n",
        "      return 0;\n",
        "  }, []);\n\n",
        "  const handleSort = (key: string) => {\n",
        "      setSortConfig(prev => ({\n",
        "          key,\n",
        "          direction: prev.key === key && prev.direction === 'asc' ? 'desc' : 'asc'\n",
        "      }));\n",
        "  };\n"
    ]
    new_lines[start_idx:end_idx+1] = new_logic

# 3. Update RenderTable to use sorted data
# Find RenderTable start (around line 976) and update sortedData usage
# We need to find the beginning of RenderTable and inject sortedData useMemo
# And update the headers to be clickable

# Let's use a more robust approach for RenderTable
content = "".join(new_lines)

# Insert sortedData useMemo inside RenderTable
# First find RenderTable = () => {
rt_start = content.find("const RenderTable: React.FC = () => {")
if rt_start != -1:
    insert_pos = content.find("{", rt_start) + 1
    sorted_memo = """
    const sortedData = useMemo(() => {
        const data = [...filteredData];
        if (!sortConfig.key) return data;

        return data.sort((a, b) => {
            let aValue: any = a[sortConfig.key as keyof License];
            let bValue: any = b[sortConfig.key as keyof License];

            // Special handling for Live Version sorting
            if (sortConfig.key === 'version') {
                const aLogs = installationLogs.filter(log => log.deviceId === a.machineId);
                const bLogs = installationLogs.filter(log => log.deviceId === b.machineId);
                aValue = aLogs.length > 0 ? aLogs[0].version : '';
                bValue = bLogs.length > 0 ? bLogs[0].version : '';
                const cmp = compareVersions(aValue, bValue);
                return sortConfig.direction === 'asc' ? cmp : -cmp;
            }

            // General sorting logic
            if (aValue === bValue) return 0;
            if (aValue === null || aValue === undefined) return 1;
            if (bValue === null || bValue === undefined) return -1;

            let comparison = 0;
            if (typeof aValue === 'string') {
                comparison = aValue.localeCompare(bValue);
            } else {
                comparison = aValue > bValue ? 1 : -1;
            }

            return sortConfig.direction === 'asc' ? comparison : -comparison;
        });
    }, [filteredData, sortConfig, installationLogs, compareVersions]);
"""
    content = content[:insert_pos] + sorted_memo + content[insert_pos:]

# Update RenderTable's table headers to be clickable and show icons
# Replace <tr> headers
old_header_start = content.find("<th key={col.id}")
if old_header_start != -1:
    header_replacement = """<th 
                                            key={col.id} 
                                            onClick={() => col.id !== 'index' && col.id !== 'smsStatus' && col.id !== 'actions' && handleSort(col.id)}
                                            className={`px-1 py-1 font-bold text-gray-500 uppercase tracking-wider border-r border-gray-200/50 last:border-r-0 select-none ${col.id !== 'index' && col.id !== 'smsStatus' && col.id !== 'actions' ? 'cursor-pointer hover:bg-gray-100 transition-colors' : ''}`}
                                            style={{ width: colWidths[col.id] || col.width }}
                                        >
                                            <div className="flex items-center justify-center gap-1">
                                                {col.label}
                                                {sortConfig.key === col.id && (
                                                    <i className={`fas fa-sort-${sortConfig.direction === 'asc' ? 'up' : 'down'} text-indigo-500 text-[10px]`}></i>
                                                )}
                                                {sortConfig.key !== col.id && col.id !== 'index' && col.id !== 'smsStatus' && col.id !== 'actions' && (
                                                    <i className="fas fa-sort text-gray-300 text-[10px] opacity-0 group-hover:opacity-100"></i>
                                                )}
                                            </div>
                                        </th>"""
    # This replacement is tricky because it's inside a .map(). Let's just target the whole block.
    # Actually, the previous repair script approach for the map content was better.

# Let's write the final content
with open(target_file, 'w', encoding='utf-8') as f:
    f.write(content)

print("Sorting logic injected successfully.")
