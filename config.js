/* ====================================================================
   1) 把下面替换成你自己 Firebase 项目的配置
   （Firebase 控制台 → 项目设置 → 你的应用 → SDK 配置）
   并在 Realtime Database 里把读写规则先设为测试模式。
   ==================================================================== */
const firebaseConfig = {
  apiKey: "AIzaSyA9mTge3zqSagzpZ-k9Vu-huQFcuJh72vw",
  authDomain: "sgs666-733bf.firebaseapp.com",
  databaseURL: "https://sgs666-733bf-default-rtdb.firebaseio.com",
  projectId: "sgs666-733bf",
  storageBucket: "sgs666-733bf.firebasestorage.app",
  messagingSenderId: "776543884034",
  appId: "1:776543884034:web:3736396f39da4973cf681b",
  measurementId: "G-KWKN0XND40"
};
/* ==================================================================== */

const NOT_CONFIGURED = firebaseConfig.apiKey === "YOUR_API_KEY";
let db = null;
if (!NOT_CONFIGURED) {
  firebase.initializeApp(firebaseConfig);
  db = firebase.database();
} else {
  document.getElementById('configWarn').classList.remove('hidden');
}
