import React, { useState, useEffect } from 'react';
import { Product, Customer, Order, OrderStatus, LicenseType, LicenseStatus } from '../types';
import { 
  getOrders, saveOrder, deleteOrder,
  getProducts, getCustomers, 
  saveLicense, generateSerialKey 
} from '../services/storageService';
import { parseDepositText } from '../services/geminiService';

const DepositManager: React.FC = () => {
  const [orders, setOrders] = useState<Order[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  
  // New Order Form
  const [showOrderModal, setShowOrderModal] = useState(false);
  const [newOrder, setNewOrder] = useState<Partial<Order>>({});

  // Deposit Processing
  const [smsText, setSmsText] = useState('');
  const [processing, setProcessing] = useState(false);
  const [matchResult, setMatchResult] = useState<null | { success: boolean; message: string; data?: any }>(null);

  useEffect(() => {
    refreshData();
  }, []);

  // [NEW] Global Refresh Event Listener
  useEffect(() => {
    const handleGlobalRefresh = () => {
        refreshData();
    };
    window.addEventListener('REFRESH_DATA', handleGlobalRefresh);
    return () => window.removeEventListener('REFRESH_DATA', handleGlobalRefresh);
  }, []);

  const refreshData = async () => {
    setLoading(true);
    const o = await getOrders();
    const p = await getProducts();
    const c = await getCustomers();
    setOrders(o);
    setProducts(p);
    setCustomers(c);
    setLoading(false);
  };

  const handleCreateOrder = async () => {
    if (!newOrder.customerId || !newOrder.productId || !newOrder.amount) return;
    
    setLoading(true);
    const order: Order = {
      id: Date.now().toString(),
      customerId: newOrder.customerId,
      productId: newOrder.productId,
      amount: Number(newOrder.amount),
      depositorName: newOrder.depositorName || '',
      status: OrderStatus.PENDING,
      createdAt: new Date().toISOString()
    };

    await saveOrder(order);
    setShowOrderModal(false);
    setNewOrder({});
    await refreshData();
  };

  const handleProcessDeposit = async () => {
    if (!smsText.trim()) return;
    setProcessing(true);
    setMatchResult(null);

    // 1. AI Parsing
    const parsedData = await parseDepositText(smsText);

    if (!parsedData) {
      setMatchResult({ success: false, message: '문자 내용을 분석할 수 없습니다.' });
      setProcessing(false);
      return;
    }

    // 2. Matching Logic
    const matchedOrder = orders.find(o => 
      o.status === OrderStatus.PENDING && 
      o.amount === parsedData.amount && 
      (o.depositorName === parsedData.name || customers.find(c => c.id === o.customerId)?.name === parsedData.name)
    );

    if (matchedOrder) {
      // 3. Auto Approve & Generate License
      const license = {
        id: Date.now().toString(),
        key: generateSerialKey(),
        productId: matchedOrder.productId,
        customerId: matchedOrder.customerId,
        type: LicenseType.LIFETIME,
        status: LicenseStatus.ACTIVE,
        paymentStatus: 'PAID', // 입금 확인됨 자동 설정
        createdAt: new Date().toISOString(),
        expiresAt: null
      };
      
      // @ts-ignore
      await saveLicense(license);
      
      const updatedOrder = { 
        ...matchedOrder, 
        status: OrderStatus.PAID, 
        licenseId: license.id 
      };
      await saveOrder(updatedOrder);

      setMatchResult({ 
        success: true, 
        message: `매칭 성공! [${parsedData.name}]님 확인됨. 라이선스가 자동 발급되었습니다.`,
        data: parsedData
      });
      await refreshData();
    } else {
      setMatchResult({ 
        success: false, 
        message: `매칭 실패. 금액(${parsedData.amount})과 이름(${parsedData.name})이 일치하는 대기 주문이 없습니다.`,
        data: parsedData
      });
    }

    setProcessing(false);
  };

  if (loading && orders.length === 0) {
    return <div className="p-10 text-center text-gray-500"><i className="fas fa-spinner fa-spin mr-2"></i> 데이터 로딩 중...</div>;
  }

  return (
    <div className="flex flex-col gap-6 animate-fade-in h-full relative">
      {loading && orders.length > 0 && (
         <div className="absolute top-2 right-2 z-10 bg-white/80 p-2 rounded shadow text-xs">
           <i className="fas fa-sync fa-spin"></i> 갱신 중...
         </div>
      )}

      <div className="flex flex-col lg:flex-row gap-6 flex-1 min-h-0">
        
        {/* Left: Pending Orders */}
        <div className="flex-1 bg-white rounded-xl shadow-sm border border-gray-100 flex flex-col min-h-0">
          {/* ... Header ... */}
          <div className="p-6 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-bold text-gray-800">
              <i className="fas fa-clock text-orange-500 mr-2"></i> 입금 대기 주문
            </h2>
            <button 
              onClick={() => setShowOrderModal(true)}
              className="bg-indigo-600 text-white px-3 py-1.5 rounded-lg text-sm font-medium hover:bg-indigo-700"
            >
              + 주문 추가
            </button>
          </div>
          
          <div className="flex-1 overflow-auto p-0">
            <table className="w-full text-left">
              <thead className="bg-gray-50 sticky top-0">
                <tr className="text-gray-500 text-xs uppercase tracking-wider">
                  <th className="px-6 py-3 font-medium">고객 / 입금자명</th>
                  <th className="px-6 py-3 font-medium">제품</th>
                  <th className="px-6 py-3 font-medium">금액</th>
                  <th className="px-6 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {orders.filter(o => o.status === OrderStatus.PENDING).length === 0 && (
                   <tr><td colSpan={4} className="text-center py-10 text-gray-400">대기 중인 주문이 없습니다.</td></tr>
                )}
                {orders.filter(o => o.status === OrderStatus.PENDING).map(order => {
                  const prod = products.find(p => p.id === order.productId);
                  const cust = customers.find(c => c.id === order.customerId);
                  return (
                    <tr key={order.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-6 py-4">
                        <div className="font-medium text-gray-900">{cust?.name}</div>
                        <div className="text-xs text-gray-500">입금자: {order.depositorName}</div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-600">{prod?.name}</td>
                      <td className="px-6 py-4 font-mono font-medium text-indigo-600">
                        {order.amount.toLocaleString()}원
                      </td>
                      <td className="px-6 py-4">
                        <span className="px-2 py-1 bg-orange-100 text-orange-700 rounded-full text-xs font-bold">
                          입금 대기
                        </span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: AI Auto Processor (Unchanged mostly) */}
        <div className="w-full lg:w-96 bg-gradient-to-br from-slate-800 to-slate-900 rounded-xl shadow-xl p-6 text-white flex flex-col">
          <h2 className="text-lg font-bold mb-1 flex items-center">
            <i className="fas fa-magic mr-2 text-yellow-400"></i> AI 입금 자동 처리
          </h2>
          <p className="text-slate-400 text-xs mb-6">
            은행 앱의 입금 알림 문자나 카카오톡 알림을 붙여넣으면, AI가 분석하여 자동으로 주문을 처리합니다.
          </p>

          <div className="flex-1 flex flex-col space-y-4">
            <textarea
              className="w-full h-32 bg-slate-700 border border-slate-600 rounded-lg p-3 text-sm text-white placeholder-slate-400 focus:ring-2 focus:ring-indigo-500 outline-none resize-none"
              placeholder="예: [카카오뱅크] 홍길동님 50,000원 입금"
              value={smsText}
              onChange={e => setSmsText(e.target.value)}
            ></textarea>
            
            <button
              onClick={handleProcessDeposit}
              disabled={processing || !smsText}
              className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-600 text-white py-3 rounded-lg font-bold transition-all flex justify-center items-center shadow-lg shadow-indigo-900/50"
            >
              {processing ? (
                <>
                  <i className="fas fa-circle-notch fa-spin mr-2"></i> 분석 및 처리 중...
                </>
              ) : (
                '자동 매칭 실행'
              )}
            </button>

            {matchResult && (
              <div className={`p-4 rounded-lg border text-sm ${matchResult.success ? 'bg-green-500/20 border-green-500/50 text-green-200' : 'bg-red-500/20 border-red-500/50 text-red-200'}`}>
                <div className="font-bold mb-1">
                  {matchResult.success ? <i className="fas fa-check-circle mr-1"></i> : <i className="fas fa-exclamation-triangle mr-1"></i>}
                  {matchResult.success ? '처리 성공' : '처리 실패'}
                </div>
                <div>{matchResult.message}</div>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Create Order Modal (Unchanged logic, just async usage) */}
      {showOrderModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-6 animate-fade-in">
             {/* ... form content ... */}
             <h3 className="text-xl font-bold text-gray-800 mb-4">새 주문 등록 (입금 대기)</h3>
             <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">제품</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none"
                  value={newOrder.productId || ''}
                  onChange={e => {
                    const prod = products.find(p => p.id === e.target.value);
                    setNewOrder({...newOrder, productId: e.target.value, amount: prod?.price});
                  }}
                >
                  <option value="">선택하세요</option>
                  {products.map(p => <option key={p.id} value={p.id}>{p.name} ({p.price}원)</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">고객</label>
                <select 
                  className="w-full border border-gray-300 rounded-lg p-2.5 outline-none"
                  value={newOrder.customerId || ''}
                  onChange={e => {
                    const cust = customers.find(c => c.id === e.target.value);
                    setNewOrder({...newOrder, customerId: e.target.value, depositorName: cust?.name});
                  }}
                >
                  <option value="">선택하세요</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">입금 예정 금액</label>
                <input type="number" className="w-full border border-gray-300 rounded-lg p-2.5 outline-none"
                  value={newOrder.amount || ''} onChange={e => setNewOrder({...newOrder, amount: Number(e.target.value)})} />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">입금자명 (매칭용)</label>
                <input type="text" className="w-full border border-gray-300 rounded-lg p-2.5 outline-none" placeholder="예: 홍길동"
                  value={newOrder.depositorName || ''} onChange={e => setNewOrder({...newOrder, depositorName: e.target.value})} />
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setShowOrderModal(false)} className="flex-1 bg-gray-100 text-gray-700 py-3 rounded-lg hover:bg-gray-200">취소</button>
                <button onClick={handleCreateOrder} className="flex-1 bg-indigo-600 text-white py-3 rounded-lg hover:bg-indigo-700">등록</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default DepositManager;